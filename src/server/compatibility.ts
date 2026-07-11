export const SKILLMAP_PRODUCT_VERSION = '0.1.0' as const;
export const LOCAL_CONNECTOR_API_VERSION = 'v1' as const;
export const LOCAL_APP_ASSET_VERSION = 'v1' as const;

export const LOCAL_CONNECTOR_COMPATIBILITY_RECEIPT = Object.freeze({
  apiVersion: LOCAL_CONNECTOR_API_VERSION,
  localAppAssetVersion: LOCAL_APP_ASSET_VERSION,
  productVersion: SKILLMAP_PRODUCT_VERSION
});

export function connectorCompatibilityReceipt(): typeof LOCAL_CONNECTOR_COMPATIBILITY_RECEIPT {
  return { ...LOCAL_CONNECTOR_COMPATIBILITY_RECEIPT };
}
