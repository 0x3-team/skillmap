import process from 'node:process';
import { Transform, type TransformCallback, type Readable, type Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SKILLMAP_MCP_REQUEST_LINE_BYTES } from '../tool-schemas.js';

export class SkillMapMcpRequestLimitError extends Error {
  readonly code = 'REQUEST_TOO_LARGE';

  constructor(readonly maxBytes: number) {
    super(`SkillMap MCP requests must not exceed ${maxBytes} bytes per line.`);
    this.name = 'SkillMapMcpRequestLimitError';
  }
}

/**
 * Buffers at most one bounded line and only releases complete frames to the SDK.
 * JSON-RPC parsing and dispatch remain entirely inside StdioServerTransport.
 */
export class BoundedMcpLineReadable extends Transform {
  private readonly fragments: Buffer[] = [];
  private bufferedBytes = 0;
  private rejected = false;

  constructor(readonly maxLineBytes = SKILLMAP_MCP_REQUEST_LINE_BYTES) {
    super();
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
      throw new Error('maxLineBytes must be a positive safe integer.');
    }
  }

  override _transform(chunkValue: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.rejected) {
      callback();
      return;
    }
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue, encoding);
    let offset = 0;
    try {
      while (offset < chunk.length) {
        const newline = chunk.indexOf(0x0a, offset);
        const end = newline < 0 ? chunk.length : newline;
        const segmentLength = end - offset;
        if (this.bufferedBytes + segmentLength > this.maxLineBytes) {
          this.rejected = true;
          callback(new SkillMapMcpRequestLimitError(this.maxLineBytes));
          return;
        }
        if (segmentLength > 0) {
          this.fragments.push(Buffer.from(chunk.subarray(offset, end)));
          this.bufferedBytes += segmentLength;
        }
        if (newline < 0) break;
        this.pushBufferedLine();
        offset = newline + 1;
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    if (!this.rejected && this.bufferedBytes > 0) this.pushBufferedLine();
    callback();
  }

  private pushBufferedLine(): void {
    const line = this.fragments.length === 1
      ? this.fragments[0]
      : Buffer.concat(this.fragments, this.bufferedBytes);
    this.fragments.length = 0;
    this.bufferedBytes = 0;
    if (line.toString('utf8').trim().length === 0) return;
    this.push(line);
    this.push(Buffer.from('\n'));
  }
}

export interface BoundedStdioServerTransportOptions {
  input?: Readable;
  output?: Writable;
  maxLineBytes?: number;
  onLimitError?: (error: SkillMapMcpRequestLimitError) => void;
}

/** Official SDK stdio transport fed by a bounded, line-aware Readable adapter. */
export class BoundedStdioServerTransport extends StdioServerTransport {
  private readonly source: Readable;
  private readonly boundedInput: BoundedMcpLineReadable;
  private readonly sourceErrorHandler: (error: Error) => void;
  private closed = false;

  constructor(options: BoundedStdioServerTransportOptions = {}) {
    const source = options.input ?? process.stdin;
    const boundedInput = new BoundedMcpLineReadable(options.maxLineBytes ?? SKILLMAP_MCP_REQUEST_LINE_BYTES);
    super(boundedInput, options.output ?? process.stdout);
    this.source = source;
    this.boundedInput = boundedInput;
    this.sourceErrorHandler = (error) => boundedInput.destroy(error);
    source.on('error', this.sourceErrorHandler);
    boundedInput.once('error', (error) => {
      if (error instanceof SkillMapMcpRequestLimitError) options.onLimitError?.(error);
      void this.close();
    });
    source.pipe(boundedInput);
  }

  override async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.source.unpipe(this.boundedInput);
    this.source.off('error', this.sourceErrorHandler);
    this.source.pause();
    if (!this.boundedInput.destroyed) this.boundedInput.destroy();
    await super.close();
  }
}

export function createBoundedStdioServerTransport(
  options: BoundedStdioServerTransportOptions = {}
): BoundedStdioServerTransport {
  return new BoundedStdioServerTransport(options);
}
