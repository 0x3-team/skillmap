export interface DeviceAuthMetadata {
  deviceId: string;
  verificationUri: string;
  displayName?: string;
  platform?: 'macos' | 'windows' | 'linux';
  connectorVersion?: string;
}

export interface DeviceAuthMetadataStore {
  load(): Promise<DeviceAuthMetadata | null>;
  save(metadata: DeviceAuthMetadata): Promise<void>;
  delete(): Promise<void>;
}

export class InMemoryDeviceAuthMetadataStore implements DeviceAuthMetadataStore {
  private metadata: DeviceAuthMetadata | null = null;

  public async load(): Promise<DeviceAuthMetadata | null> {
    return this.metadata ? { ...this.metadata } : null;
  }

  public async save(metadata: DeviceAuthMetadata): Promise<void> {
    this.metadata = { ...metadata };
  }

  public async delete(): Promise<void> {
    this.metadata = null;
  }
}
