import CryptoKit
import Darwin
import Foundation
import LocalAuthentication
import Security

private let schema = "skillmap.m3-03.dp-keychain-failure-recovery.native.adhoc.v2"
private let pairDomain = "skillmap.m3-03.recovery-pair.v1"
private let bootDomain = "skillmap.m3-03.recovery-boot-audit-session.v1"
private let expectedAccessibility = kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String

private enum RecoveryError: Error {
    case environment
    case malformed
    case auditUnavailable
    case auditInvalid
    case bootUnavailable
    case authorityUnavailable
}

private func hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func emit(_ value: [String: Any]) -> Never {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else {
        FileHandle.standardOutput.write(Data("{\"schema\":\"skillmap.m3-03.dp-keychain-failure-recovery.native.adhoc.v2\",\"status\":\"BLOCKED_NATIVE_SERIALIZATION\"}\n".utf8))
        exit(0)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    exit(0)
}

private func environment(_ key: String) throws -> String {
    guard let value = ProcessInfo.processInfo.environment[key], !value.isEmpty, !value.contains("\0") else {
        throw RecoveryError.environment
    }
    return value
}

private func executionContext() throws -> (row: String, outputPath: String?) {
    guard try environment("SKILLMAP_M303_DP_EXECUTION_SIGNATURE") == "adhoc" else {
        throw RecoveryError.environment
    }
    let row = try environment("SKILLMAP_M303_DP_ROW")
    guard row == "unsigned" || row == "adhoc" else { throw RecoveryError.environment }
    if CommandLine.arguments.contains("--context-only") { return (row, nil) }
    let path = try environment("SKILLMAP_M303_CANDIDATE_PATH")
    guard path.hasPrefix("/"), path.utf8.count <= 1024 else { throw RecoveryError.environment }
    return (row, path)
}

private func statusName(_ code: OSStatus) -> String {
    switch code {
    case errSecSuccess: return "errSecSuccess"
    case errSecItemNotFound: return "errSecItemNotFound"
    case errSecParam: return "errSecParam"
    case errSecInteractionNotAllowed: return "errSecInteractionNotAllowed"
    case errSecMissingEntitlement: return "errSecMissingEntitlement"
    default: return "unknown_osstatus"
    }
}

private func auditSessionID() throws -> Int64 {
    var token = audit_token_t()
    let countExpected = mach_msg_type_number_t(MemoryLayout<audit_token_t>.size / MemoryLayout<natural_t>.size)
    var count = countExpected
    let result = withUnsafeMutablePointer(to: &token) { pointer in
        pointer.withMemoryRebound(to: integer_t.self, capacity: Int(countExpected)) { rebound in
            task_info(mach_task_self_, task_flavor_t(TASK_AUDIT_TOKEN), rebound, &count)
        }
    }
    guard result == KERN_SUCCESS, count == countExpected else { throw RecoveryError.auditUnavailable }
    let value: au_asid_t = audit_token_to_asid(token)
    let asid = Int64(value)
    guard asid > 0, asid != Int64(AU_DEFAUDITSID), asid != Int64(AU_ASSIGN_ASID), String(asid) == "\(asid)" else {
        throw RecoveryError.auditInvalid
    }
    return asid
}

private func bootUUID() throws -> String {
    var size = 0
    guard sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 1 else { throw RecoveryError.bootUnavailable }
    var buffer = [CChar](repeating: 0, count: size)
    guard sysctlbyname("kern.bootsessionuuid", &buffer, &size, nil, 0) == 0 else { throw RecoveryError.bootUnavailable }
    let raw = String(cString: buffer).lowercased()
    guard raw.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else {
        throw RecoveryError.bootUnavailable
    }
    return raw
}

private func contextDigest() throws -> String {
    let boot = try bootUUID()
    let asid = try auditSessionID()
    return hex(Data("\(bootDomain)\0\(boot)\0\(asid)".utf8))
}

private func exactService(_ row: String, _ value: String) -> Bool {
    let prefix = row == "unsigned" ? "skillmap-m303-dp-unsigned-" : "skillmap-m303-dp-adhoc-"
    let length = row == "unsigned" ? 50 : 47
    guard value.utf8.count == length, value.hasPrefix(prefix) else { return false }
    let suffix = value.dropFirst(prefix.count)
    return suffix.count == 24 && suffix.allSatisfy { $0.isNumber || ("a"..."f").contains($0) }
}

private func exactAccount(_ value: String) -> Bool {
    guard value.utf8.count == 34, value.hasPrefix("synthetic-") else { return false }
    let suffix = value.dropFirst(10)
    return suffix.count == 24 && suffix.allSatisfy { $0.isNumber || ("a"..."f").contains($0) }
}

private func pairFingerprint(row: String, service: String, account: String) -> String {
    hex(Data("\(pairDomain)\0\(row)\0\(service)\0\(account)".utf8))
}

private func writeCandidateFile(_ path: String, bytes: Data) throws {
    let descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw RecoveryError.authorityUnavailable }
    defer { close(descriptor) }
    var offset = 0
    try bytes.withUnsafeBytes { raw in
        guard let base = raw.baseAddress else { return }
        while offset < raw.count {
            let written = write(descriptor, base.advanced(by: offset), raw.count - offset)
            guard written > 0 else { throw RecoveryError.authorityUnavailable }
            offset += written
        }
    }
    guard fsync(descriptor) == 0 else { throw RecoveryError.authorityUnavailable }
}

private func inventory(row: String, outputPath: String) throws -> [String: Any] {
    let context = LAContext()
    context.interactionNotAllowed = true
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecUseDataProtectionKeychain as String: true,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAttrSynchronizable as String: false,
        kSecMatchLimit as String: kSecMatchLimitAll,
        kSecReturnAttributes as String: true,
        kSecUseAuthenticationContext as String: context,
    ]
    var raw: CFTypeRef?
    let code = SecItemCopyMatching(query as CFDictionary, &raw)
    guard code == errSecSuccess || code == errSecItemNotFound else {
        try writeCandidateFile(outputPath, bytes: Data())
        return ["schema": schema, "execution_signature_state": "adhoc", "inventory_namespace": row, "status": statusName(code), "candidate_count": 0, "pair_fingerprints": [], "context_sha256": try contextDigest()]
    }
    guard code != errSecItemNotFound else {
        try writeCandidateFile(outputPath, bytes: Data())
        return ["schema": schema, "execution_signature_state": "adhoc", "inventory_namespace": row, "status": statusName(code), "candidate_count": 0, "pair_fingerprints": [], "context_sha256": try contextDigest()]
    }
    guard let values = raw as? [Any] else { throw RecoveryError.malformed }
    var records: [(String, String, String, String)] = []
    for value in values {
        guard let item = value as? [String: Any], let service = item[kSecAttrService as String] as? String, let account = item[kSecAttrAccount as String] as? String else { continue }
        guard exactService(row, service), exactAccount(account) else { continue }
        guard let accessible = item[kSecAttrAccessible as String] as? String, accessible == expectedAccessibility else { throw RecoveryError.malformed }
        guard let sync = item[kSecAttrSynchronizable as String] as? NSNumber, sync.boolValue == false else { throw RecoveryError.malformed }
        if let group = item[kSecAttrAccessGroup as String] as? String {
            guard !group.isEmpty, !group.contains("\0"), group.utf8.count <= 1024 else { throw RecoveryError.malformed }
            records.append((service, account, "present", group))
        } else {
            records.append((service, account, "none", ""))
        }
        guard records.count <= 1 else { throw RecoveryError.malformed }
    }
    let bytes = records.reduce(into: Data()) { result, record in
        result.append(contentsOf: row.utf8); result.append(0)
        result.append(contentsOf: record.0.utf8); result.append(0)
        result.append(contentsOf: record.1.utf8); result.append(0)
        result.append(contentsOf: record.2.utf8); result.append(0)
        result.append(contentsOf: record.3.utf8); result.append(0)
    }
    try writeCandidateFile(outputPath, bytes: bytes)
    return ["schema": schema, "execution_signature_state": "adhoc", "inventory_namespace": row, "status": statusName(code), "candidate_count": records.count, "pair_fingerprints": records.map { pairFingerprint(row: row, service: $0.0, account: $0.1) }, "context_sha256": try contextDigest()]
}

let arguments = Array(CommandLine.arguments.dropFirst())
do {
    let context = try executionContext()
    if arguments == ["--context-only"] {
        emit(["schema": schema, "execution_signature_state": "adhoc", "inventory_namespace": context.row, "status": "CONTEXT", "context_sha256": try contextDigest()])
    }
    guard arguments == ["--inventory-only"], let path = context.outputPath else { throw RecoveryError.environment }
    emit(try inventory(row: context.row, outputPath: path))
} catch RecoveryError.auditUnavailable {
    emit(["schema": schema, "execution_signature_state": "adhoc", "status": "BLOCKED_AUDIT_SESSION_UNAVAILABLE"])
} catch RecoveryError.auditInvalid {
    emit(["schema": schema, "execution_signature_state": "adhoc", "status": "BLOCKED_AUDIT_SESSION_INVALID"])
} catch {
    emit(["schema": schema, "execution_signature_state": "adhoc", "status": "ADHOC_DRY_RUN_PRE_BUNDLE_BLOCKED"])
}
