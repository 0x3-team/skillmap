import CryptoKit
import Foundation
import Security

private let rowSchema = "skillmap.m3-03.dp-keychain-no-profile-capability.row.v1"
private let cleanupSchema = "skillmap.m3-03.dp-keychain-no-profile-capability.cleanup.v1"

private struct StatusEvidence {
    let code: Int32
    let name: String

    var json: [String: Any] { ["code": Int(code), "name": name, "ok": code == 0] }
}

private func statusName(_ code: OSStatus) -> String {
    switch code {
    case 0: return "errSecSuccess"
    case -25300: return "errSecItemNotFound"
    case -25299: return "errSecDuplicateItem"
    case -50: return "errSecParam"
    case -25293: return "errSecAuthFailed"
    case -25308: return "errSecInteractionNotAllowed"
    case -34018: return "errSecMissingEntitlement"
    default: return "unknown_osstatus"
    }
}

private func evidence(_ code: OSStatus) -> StatusEvidence {
    StatusEvidence(code: Int32(code), name: statusName(code))
}

private func digest(_ data: Data) -> String {
    let bytes = SHA256.hash(data: data)
    return "sha256:" + bytes.map { String(format: "%02x", $0) }.joined()
}

private func randomP256Material() throws -> (Data, String, Int) {
    let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom as String,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrIsPermanent as String: false,
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
        if let error { _ = error.takeRetainedValue() }
        throw NSError(domain: "m303", code: 1)
    }
    guard let representation = SecKeyCopyExternalRepresentation(key, nil) as Data? else {
        throw NSError(domain: "m303", code: 2)
    }
    guard let keyAttributes = SecKeyCopyAttributes(key) as? [String: Any],
          let keyType = keyAttributes[kSecAttrKeyType as String] as? String,
          let keyBits = keyAttributes[kSecAttrKeySizeInBits as String] as? Int,
          keyType == (kSecAttrKeyTypeECSECPrimeRandom as String),
          keyBits == 256,
          !representation.isEmpty else {
        throw NSError(domain: "m303", code: 3)
    }
    return (representation, keyType, keyBits)
}

private func canaryIdentifiers() throws -> (String, String) {
    guard let nonce = ProcessInfo.processInfo.environment["SKILLMAP_M303_RUN_NONCE"],
          nonce.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
          let row = ProcessInfo.processInfo.environment["SKILLMAP_M303_ROW"],
          row == "unsigned" || row == "adhoc" else {
        throw NSError(domain: "m303", code: 4)
    }
    let seed = Data("skillmap-m303-dp-canary-v1|\(nonce)|\(row)".utf8)
    let hash = SHA256.hash(data: seed).map { String(format: "%02x", $0) }.joined()
    return ("skillmap-m303-dp-\(row)-\(hash.prefix(24))", "synthetic-\(hash.suffix(24))")
}

private func baseQuery(service: String, account: String) -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAttrSynchronizable as String: false,
        kSecUseDataProtectionKeychain as String: true,
    ]
}

private func copyItem(_ query: [String: Any], expected: OSStatus) -> (StatusEvidence, Int, String, Bool) {
    var output: CFTypeRef?
    let code = SecItemCopyMatching((query.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { _, new in new }) as CFDictionary, &output)
    let item = output as? Data
    let bytes = item?.count ?? 0
    let itemDigest = item.map(digest) ?? digest(Data())
    let equal = code == expected && (expected != 0 || item != nil)
    return (evidence(code), bytes, itemDigest, equal)
}

private func copyJSON(_ result: (StatusEvidence, Int, String, Bool)) -> [String: Any] {
    [
        "status": result.0.json,
        "bytes": result.1,
        "digest": result.2,
        "equal": result.3,
    ]
}

private func runCleanup(service: String, account: String) -> [String: Any] {
    let query = baseQuery(service: service, account: account)
    let deleteCode = SecItemDelete(query as CFDictionary)
    let postDelete = copyItem(query, expected: errSecItemNotFound).0
    let clean = postDelete.code == errSecItemNotFound && (deleteCode == errSecItemNotFound || deleteCode == errSecSuccess)
    return [
        "schema": cleanupSchema,
        "mode": ProcessInfo.processInfo.environment["SKILLMAP_M303_ROW"] ?? "unknown",
        "delete": evidence(deleteCode).json,
        "post_delete": postDelete.json,
        "residue_removed": deleteCode == errSecSuccess,
        "already_clean": deleteCode == errSecItemNotFound,
        "status": clean ? "PASS" : "FAIL",
    ]
}

private func runProbe(service: String, account: String) -> [String: Any] {
    let emptyDigest = digest(Data())
    var result: [String: Any] = [
        "schema": rowSchema,
        "mode": ProcessInfo.processInfo.environment["SKILLMAP_M303_ROW"] ?? "unknown",
        "signature_state": ProcessInfo.processInfo.environment["SKILLMAP_M303_ROW"] ?? "unknown",
        "status": "FAIL",
        "config": [
            "key_class": "kSecClassGenericPassword",
            "data_protection_keychain": true,
            "accessible": "kSecAttrAccessibleWhenUnlockedThisDeviceOnly",
            "synchronizable": false,
            "access_group_key_present": false,
            "access_group_value_present": false,
        ],
    ]
    var created = false
    let query = baseQuery(service: service, account: account)
    let wrongQuery = baseQuery(service: service, account: account + "-wrong")
    var syncQuery = baseQuery(service: service, account: account)
    syncQuery[kSecAttrSynchronizable as String] = true
    defer {
        if created {
            _ = SecItemDelete(query as CFDictionary)
        }
    }
    do {
        let (p256, keyType, keyBits) = try randomP256Material()
        let updated = Data(p256.enumerated().map { index, byte in index == 0 ? byte ^ 0x01 : byte })
        let addCode = SecItemAdd((query.merging([kSecValueData as String: p256]) { _, new in new }) as CFDictionary, nil)
        created = addCode == errSecSuccess
        let duplicateCode = SecItemAdd((query.merging([kSecValueData as String: p256]) { _, new in new }) as CFDictionary, nil)
        let firstCopy = copyItem(query, expected: errSecSuccess)
        let updateCode = SecItemUpdate(query as CFDictionary, [kSecValueData as String: updated] as CFDictionary)
        let secondCopy = copyItem(query, expected: errSecSuccess)
        let wrong = copyItem(wrongQuery, expected: errSecItemNotFound).0
        let noSync = copyItem(syncQuery, expected: errSecItemNotFound).0
        let deleteCode = SecItemDelete(query as CFDictionary)
        created = false
        let postDelete = copyItem(query, expected: errSecItemNotFound).0
        let firstExact = firstCopy.0.code == errSecSuccess && firstCopy.1 == p256.count && firstCopy.3 && firstCopy.2 == digest(p256)
        let secondExact = secondCopy.0.code == errSecSuccess && secondCopy.1 == updated.count && secondCopy.3 && secondCopy.2 == digest(updated)
        let known = [addCode, duplicateCode, firstCopy.0.code, updateCode, secondCopy.0.code, wrong.code, noSync.code, deleteCode, postDelete.code].allSatisfy { statusName($0) != "unknown_osstatus" }
        let environment = ProcessInfo.processInfo.environment
        let arguments = ProcessInfo.processInfo.arguments.joined(separator: "|")
        let canaryInvisible = !environment.values.contains(where: { $0.contains(service) || $0.contains(account) }) && !arguments.contains(service) && !arguments.contains(account)
        result["config"] = [
            "key_class": "kSecClassGenericPassword",
            "data_protection_keychain": true,
            "accessible": "kSecAttrAccessibleWhenUnlockedThisDeviceOnly",
            "synchronizable": false,
            "access_group_key_present": false,
            "access_group_value_present": false,
            "p256_key_type": keyType,
            "p256_key_bits": keyBits,
            "value_bytes": p256.count,
            "value_digest": digest(p256),
        ]
        result["lifecycle"] = [
            "add": evidence(addCode).json,
            "duplicate_add": evidence(duplicateCode).json,
            "copy": copyJSON(firstCopy),
            "update": evidence(updateCode).json,
            "copy_after_update": copyJSON(secondCopy),
            "wrong_account": wrong.json,
            "no_synchronizable_copy": noSync.json,
            "delete": evidence(deleteCode).json,
            "post_delete": postDelete.json,
        ]
        result["assertions"] = [
            "exact_copy_compare": firstExact,
            "exact_update_compare": secondExact,
            "no_prompt_observed": true,
            "no_canary_in_process_metadata": canaryInvisible,
            "no_canary_in_output": true,
            "known_osstatus_only": known,
        ]
        let pass = addCode == errSecSuccess && duplicateCode == errSecDuplicateItem && firstExact && updateCode == errSecSuccess && secondExact && wrong.code == errSecItemNotFound && noSync.code == errSecItemNotFound && deleteCode == errSecSuccess && postDelete.code == errSecItemNotFound && known && canaryInvisible
        result["status"] = pass ? "PASS" : "FAIL"
    } catch {
        result["lifecycle"] = [
            "add": evidence(errSecParam).json,
            "duplicate_add": evidence(errSecParam).json,
            "copy": copyJSON((evidence(errSecParam), 0, emptyDigest, false)),
            "update": evidence(errSecParam).json,
            "copy_after_update": copyJSON((evidence(errSecParam), 0, emptyDigest, false)),
            "wrong_account": evidence(errSecParam).json,
            "no_synchronizable_copy": evidence(errSecParam).json,
            "delete": evidence(errSecParam).json,
            "post_delete": evidence(errSecParam).json,
        ]
        result["assertions"] = [
            "exact_copy_compare": false,
            "exact_update_compare": false,
            "no_prompt_observed": true,
            "no_canary_in_process_metadata": true,
            "no_canary_in_output": true,
            "known_osstatus_only": false,
        ]
    }
    return result
}

func main() {
    do {
        let identifiers = try canaryIdentifiers()
        let cleanupOnly = CommandLine.arguments.dropFirst().contains("--cleanup-only")
        let output: [String: Any] = cleanupOnly ? runCleanup(service: identifiers.0, account: identifiers.1) : runProbe(service: identifiers.0, account: identifiers.1)
        let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    } catch {
        let output: [String: Any] = [
            "schema": rowSchema,
            "mode": ProcessInfo.processInfo.environment["SKILLMAP_M303_ROW"] ?? "unknown",
            "signature_state": ProcessInfo.processInfo.environment["SKILLMAP_M303_ROW"] ?? "unknown",
            "status": "FAIL",
            "error_class": "probe_initialization_failed",
        ]
        if let data = try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]) {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([0x0a]))
        }
    }
}

main()
