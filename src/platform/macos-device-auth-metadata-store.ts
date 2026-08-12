import type { DeviceAuthMetadata, DeviceAuthMetadataStore } from './device-auth-metadata-store.js';
import { MacOSHelperError, requestHelper, type MacOSHelperTransport } from './macos-keychain-helper-client.js';

const METADATA_KEYS = new Set(['deviceId', 'verificationUri', 'displayName', 'platform', 'connectorVersion']);

function metadataFrom(value: Record<string, unknown>): DeviceAuthMetadata {
  const keys = Object.keys(value);
  if (keys.some((key) => !METADATA_KEYS.has(key))) throw new Error('metadata_shape');
  if (typeof value.deviceId !== 'string' || !/^[A-Za-z0-9_-]{22}$/u.test(value.deviceId)) throw new Error('metadata_device_id');
  if (typeof value.verificationUri !== 'string' || value.verificationUri.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value.verificationUri)) throw new Error('metadata_verification_uri');
  if (value.verificationUri !== '') {
    let parsed: URL;
    try { parsed = new URL(value.verificationUri); } catch { throw new Error('metadata_verification_uri'); }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('metadata_verification_uri');
  }
  if (value.displayName !== undefined && (typeof value.displayName !== 'string' || value.displayName.length > 64 || /[\u0000-\u001f\u007f]/u.test(value.displayName))) throw new Error('metadata_display_name');
  if (value.connectorVersion !== undefined && (typeof value.connectorVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.connectorVersion) || value.connectorVersion.length > 128)) throw new Error('metadata_connector_version');
  if (value.platform !== undefined && value.platform !== 'macos' && value.platform !== 'windows' && value.platform !== 'linux') throw new Error('metadata_platform');
  return {
    deviceId: value.deviceId,
    verificationUri: value.verificationUri,
    ...(value.displayName !== undefined ? { displayName: value.displayName } : {}),
    ...(value.platform !== undefined ? { platform: value.platform } : {}),
    ...(value.connectorVersion !== undefined ? { connectorVersion: value.connectorVersion } : {})
  };
}

export class MacOSDeviceAuthMetadataStore implements DeviceAuthMetadataStore {
  public constructor(
    private readonly transport: MacOSHelperTransport,
    private readonly namespace = 'skillmap.device-auth.v1'
  ) {}

  public async load(): Promise<DeviceAuthMetadata | null> {
    const result = await requestHelper(this.transport, this.namespace, 'metadata_load');
    if (result.metadata === undefined || result.metadata === null) return null;
    if (typeof result.metadata !== 'object' || Array.isArray(result.metadata)) throw new MacOSHelperError('metadata_corrupt');
    try { return metadataFrom(result.metadata as Record<string, unknown>); }
    catch { throw new MacOSHelperError('metadata_corrupt'); }
  }

  public async save(metadata: DeviceAuthMetadata): Promise<void> {
    metadataFrom(metadata as unknown as Record<string, unknown>);
    await requestHelper(this.transport, this.namespace, 'metadata_save', { metadata });
  }

  public async delete(): Promise<void> {
    await requestHelper(this.transport, this.namespace, 'metadata_delete');
  }
}
