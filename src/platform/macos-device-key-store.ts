import { assertExactSpki, computeSpkiThumbprint, derToP1363, fromBase64Url, P256_SPKI_PREFIX_HEX, toBase64Url } from '../contracts/device-auth.js';
import type { DeviceKeyStore, DeviceKeyStoreInfo } from './device-key-store.js';
import { MacOSHelperError, requestHelper, type MacOSHelperTransport } from './macos-keychain-helper-client.js';

export class MacOSDeviceKeyStore implements DeviceKeyStore {
  public constructor(
    private readonly transport: MacOSHelperTransport,
    private readonly namespace = 'skillmap.device-auth.v1'
  ) {}

  public async hasKey(): Promise<boolean> {
    const result = await requestHelper(this.transport, this.namespace, 'exists_key');
    if (typeof result.exists !== 'boolean') throw new MacOSHelperError('malformed_key_state');
    return result.exists;
  }

  public async createKey(): Promise<DeviceKeyStoreInfo> {
    const result = await requestHelper(this.transport, this.namespace, 'create_key');
    const spkiBytes = spkiFromX963(result.x963_base64url);
    assertExactSpki(spkiBytes);
    const thumbprint = computeSpkiThumbprint(spkiBytes);
    return { spkiBytes, spkiBase64Url: toBase64Url(spkiBytes), thumbprint };
  }

  public async getPublicKeySpki(): Promise<Uint8Array | null> {
    try {
      const result = await requestHelper(this.transport, this.namespace, 'public_key');
      const spki = spkiFromX963(result.x963_base64url);
      assertExactSpki(spki);
      return new Uint8Array(spki);
    } catch (error) {
      if (error instanceof MacOSHelperError && error.code === 'not_found') return null;
      throw error;
    }
  }

  public async getThumbprint(): Promise<string | null> {
    const spki = await this.getPublicKeySpki();
    return spki ? computeSpkiThumbprint(spki) : null;
  }

  public async signProof(preimageUtf8: string): Promise<string> {
    const result = await requestHelper(this.transport, this.namespace, 'sign', { preimage_base64url: Buffer.from(preimageUtf8, 'utf8').toString('base64url') });
    const der = fromBase64Url(String(result.signature_der_base64url ?? ''));
    return toBase64Url(derToP1363(der));
  }

  public async deleteKey(): Promise<void> {
    await requestHelper(this.transport, this.namespace, 'delete_key');
  }
}

function spkiFromX963(value: unknown): Uint8Array {
  const x963 = fromBase64Url(typeof value === 'string' ? value : '');
  if (x963.length !== 65 || x963[0] !== 0x04) throw new MacOSHelperError('malformed_public_key');
  const spki = Buffer.concat([Buffer.from(P256_SPKI_PREFIX_HEX, 'hex'), Buffer.from(x963)]);
  assertExactSpki(spki);
  return new Uint8Array(spki);
}
