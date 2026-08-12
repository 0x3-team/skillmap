import Foundation
import Security

// Bounded M3.01 capability spike. It creates one disposable Secure Enclave
// P-256 key, proves signing without exporting the private key, and deletes the
// item before exiting. It intentionally prints no key material or secret.
let tag = Data("com.skillmap.m3.01.spike.\(UUID().uuidString)".utf8)
var callbackError: Unmanaged<CFError>?
let access = SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    SecAccessControlCreateFlags.privateKeyUsage,
    &callbackError
)

guard let access else {
    let message = callbackError?.takeRetainedValue().localizedDescription ?? "unknown"
    print("{\"status\":\"blocked\",\"stage\":\"access_control\",\"error\":\(jsonString(message))}")
    exit(2)
}

let privateKeyAttributes: [CFString: Any] = [
    kSecAttrIsPermanent: true,
    kSecAttrApplicationTag: tag,
    kSecAttrAccessControl: access,
]
let attributes: [CFString: Any] = [
    kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
    kSecAttrKeySizeInBits: 256,
    kSecAttrTokenID: kSecAttrTokenIDSecureEnclave,
    kSecPrivateKeyAttrs: privateKeyAttributes,
]

let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &callbackError)
guard let privateKey else {
    let message = callbackError?.takeRetainedValue().localizedDescription ?? "unknown"
    print("{\"status\":\"blocked\",\"stage\":\"secure_enclave_key_generation\",\"error\":\(jsonString(message))}")
    exit(3)
}

let query: [CFString: Any] = [
    kSecClass: kSecClassKey,
    kSecAttrApplicationTag: tag,
    kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
]
defer { SecItemDelete(query as CFDictionary) }

guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
    print("{\"status\":\"blocked\",\"stage\":\"public_key\"}")
    exit(4)
}

let message = Data("skillmap-m3-01-capability-spike".utf8)
callbackError = nil
guard let signature = SecKeyCreateSignature(
    privateKey,
    .ecdsaSignatureMessageX962SHA256,
    message as CFData,
    &callbackError
) else {
    let error = callbackError?.takeRetainedValue().localizedDescription ?? "unknown"
    print("{\"status\":\"blocked\",\"stage\":\"sign\",\"error\":\(jsonString(error))}")
    exit(5)
}

callbackError = nil
let verified = SecKeyVerifySignature(
    publicKey,
    .ecdsaSignatureMessageX962SHA256,
    message as CFData,
    signature as CFData,
    &callbackError
)
guard verified else {
    let error = callbackError?.takeRetainedValue().localizedDescription ?? "verification failed"
    print("{\"status\":\"blocked\",\"stage\":\"verify\",\"error\":\(jsonString(error))}")
    exit(6)
}

callbackError = nil
let exported = SecKeyCopyExternalRepresentation(privateKey, &callbackError)
let exportError = callbackError?.takeRetainedValue().localizedDescription ?? "none"
guard exported == nil else {
    print("{\"status\":\"blocked\",\"stage\":\"export_guard\",\"exported\":true}")
    exit(7)
}

print("{\"status\":\"pass\",\"algorithm\":\"ECDSA-P256\",\"secure_enclave\":true,\"signature_verified\":true,\"private_exported\":false,\"export_error_present\":\(exportError != "none")}")

func jsonString(_ value: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [value])
    let encoded = String(data: data, encoding: .utf8)!
    return String(encoded.dropFirst().dropLast())
}
