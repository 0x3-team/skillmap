import { fileURLToPath } from 'node:url';
import { accessSync, constants as fsConstants } from 'node:fs';
import { MacOSCredentialStore } from './macos-credential-store.js';
import { MacOSDeviceAuthMetadataStore } from './macos-device-auth-metadata-store.js';
import { MacOSDeviceKeyStore } from './macos-device-key-store.js';
import { SpawnedMacOSHelperTransport } from './macos-keychain-helper-client.js';

export interface MacOSCustodyStores {
  keyStore: MacOSDeviceKeyStore;
  credentialStore: MacOSCredentialStore;
  metadataStore: MacOSDeviceAuthMetadataStore;
}

export class MacOSCustodyError extends Error {
  public readonly code = 'secure_storage_unavailable';

  public constructor(reason = 'secure_storage_unavailable') {
    super('Secure credential storage is unavailable.');
    this.name = 'MacOSCustodyError';
    // Keep the diagnostic bounded and out of the user-facing error message.
    void reason;
  }
}

/** Production custody is opt-in until the native helper has been reviewed and installed. */
export function createMacOSCustodyStores(options?: { helperPath?: string; namespace?: string }): MacOSCustodyStores {
  if (process.platform !== 'darwin') {
    throw new MacOSCustodyError('unsupported_platform');
  }
  if (process.env.SKILLMAP_ENABLE_MACOS_CUSTODY !== '1') {
    throw new MacOSCustodyError('disabled');
  }
  const helperPath = options?.helperPath
    ?? process.env.SKILLMAP_MACOS_HELPER_PATH
    ?? fileURLToPath(new URL('../../native/macos-keychain-helper/skillmap-keychain-helper', import.meta.url));
  try {
    accessSync(helperPath, fsConstants.X_OK);
  } catch {
    throw new MacOSCustodyError('helper_unavailable');
  }
  const transport = new SpawnedMacOSHelperTransport(helperPath);
  const namespace = options?.namespace ?? 'skillmap.device-auth.v1';
  return {
    keyStore: new MacOSDeviceKeyStore(transport, namespace),
    credentialStore: new MacOSCredentialStore(transport, namespace),
    metadataStore: new MacOSDeviceAuthMetadataStore(transport, namespace)
  };
}
