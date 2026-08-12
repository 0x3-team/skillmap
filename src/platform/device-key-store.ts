import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  assertExactSpki,
  computeSpkiThumbprint,
  derToP1363,
  toBase64Url
} from '../contracts/device-auth.js';

export interface DeviceKeyStoreInfo {
  spkiBytes: Uint8Array;
  spkiBase64Url: string;
  thumbprint: string;
}

export interface DeviceKeyStore {
  hasKey(): Promise<boolean>;
  createKey(): Promise<DeviceKeyStoreInfo>;
  getPublicKeySpki(): Promise<Uint8Array | null>;
  getThumbprint(): Promise<string | null>;
  signProof(preimageUtf8: string): Promise<string>;
  deleteKey(): Promise<void>;
}

export class InMemoryDeviceKeyStore implements DeviceKeyStore {
  private privateKey: KeyObject | null = null;
  private publicKeySpki: Uint8Array | null = null;
  private thumbprint: string | null = null;

  public async hasKey(): Promise<boolean> {
    return this.privateKey !== null && this.publicKeySpki !== null;
  }

  public async createKey(): Promise<DeviceKeyStoreInfo> {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256'
    });
    const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
    const spkiBytes = new Uint8Array(spkiDer);
    assertExactSpki(spkiBytes);

    this.privateKey = privateKey;
    this.publicKeySpki = spkiBytes;
    this.thumbprint = computeSpkiThumbprint(spkiBytes);

    return {
      spkiBytes,
      spkiBase64Url: toBase64Url(spkiBytes),
      thumbprint: this.thumbprint
    };
  }

  public async getPublicKeySpki(): Promise<Uint8Array | null> {
    return this.publicKeySpki ? new Uint8Array(this.publicKeySpki) : null;
  }

  public async getThumbprint(): Promise<string | null> {
    return this.thumbprint;
  }

  public async signProof(preimageUtf8: string): Promise<string> {
    if (!this.privateKey) {
      throw new Error('Device key not initialized');
    }
    const derSignature = sign('sha256', Buffer.from(preimageUtf8, 'utf8'), this.privateKey);
    const p1363Signature = derToP1363(derSignature);
    return toBase64Url(p1363Signature);
  }

  public async deleteKey(): Promise<void> {
    this.privateKey = null;
    this.publicKeySpki = null;
    this.thumbprint = null;
  }
}
