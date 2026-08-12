import Foundation
import Security
import Darwin
import CryptoKit

// SkillMap's native custody boundary. The process accepts exactly one bounded
// length-prefixed binary request and emits exactly one bounded response. Secrets
// are received only on stdin and are never placed in argv, environment, or logs.
let maxFrame = 8 * 1024
let maxFrameBody = maxFrame - 4
let maxCredentialRecord = 4 * 1024
let helperMagic = Data("SKMP".utf8)
let credentialMagic = Data("SKCR".utf8)
let envelopeMagic = Data("SKEN".utf8)
var wireOperation = ""
var wireNamespace = "skillmap.device-auth.v1"

func validNamespace(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard bytes.count >= 1 && bytes.count <= 64 else { return false }
    func alphaNumeric(_ byte: UInt8) -> Bool { (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) }
    guard alphaNumeric(bytes[0]) else { return false }
    return bytes.dropFirst().allSatisfy { alphaNumeric($0) || $0 == 46 || $0 == 45 || $0 == 95 }
}

func frameError(_ code: String) -> [String: Any] {
    ["version": 1, "ok": false, "error": ["code": code]]
}

func frameSuccess(_ result: [String: Any] = [:]) -> [String: Any] {
    ["version": 1, "ok": true, "result": result]
}

func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

func decodeBase64URL(_ value: String) -> Data? {
    var text = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    text += String(repeating: "=", count: (4 - text.count % 4) % 4)
    return Data(base64Encoded: text)
}

struct WireField { let id: UInt8; let bytes: Data }
func parseTLV(_ data: Data, max: Int) throws -> [WireField] {
    guard data.count <= max else { throw NSError(domain: "protocol", code: 1) }
    var fields: [WireField] = []; var offset = 0; var previous: UInt8 = 0
    while offset < data.count {
        guard data.count - offset >= 3 else { throw NSError(domain: "protocol", code: 2) }
        let id = data[offset]; let length = Int(data[offset + 1]) << 8 | Int(data[offset + 2]); offset += 3
        guard id > previous, data.count - offset >= length else { throw NSError(domain: "protocol", code: 3) }
        fields.append(WireField(id: id, bytes: data.subdata(in: offset..<(offset + length)))); previous = id; offset += length
    }
    return fields
}
func operationCode(_ operation: String) -> UInt8? {
    ["create_key": 1, "public_key": 2, "sign": 3, "exists_key": 4, "delete_key": 5,
     "credential_load": 16, "credential_commit_exchange": 17, "credential_mark_refresh_pending": 18,
     "credential_commit_refresh": 19, "credential_delete": 20, "metadata_load": 32,
     "metadata_save": 33, "metadata_delete": 34][operation]
}
func operationDomain(_ operation: String) -> UInt8 {
    if ["create_key", "public_key", "sign", "exists_key", "delete_key"].contains(operation) { return 1 }
    if operation.hasPrefix("credential_") { return 2 }
    return 3
}
func field(_ fields: [WireField], _ id: UInt8) -> Data? { fields.first(where: { $0.id == id })?.bytes }
func exactFieldIDs(_ fields: [WireField], _ expected: [UInt8]) -> Bool { fields.map(\.id) == expected }
func operationRequestFields(_ operation: String) -> [UInt8] {
    if ["sign", "credential_commit_exchange", "credential_mark_refresh_pending", "metadata_save"].contains(operation) { return [1, 2] }
    if operation == "credential_commit_refresh" { return [1, 2, 3] }
    return [1]
}
func readFrame() -> [String: Any] {
    var input = Data()
    while true {
        guard let chunk = try? FileHandle.standardInput.read(upToCount: maxFrame + 5), !chunk.isEmpty else { break }
        input.append(chunk)
        if input.count > maxFrame { return frameError("frame_length") }
    }
    guard input.count >= 4 else { return frameError("frame_truncated") }
    let length = Int(input[input.startIndex]) << 24 | Int(input[input.startIndex + 1]) << 16 | Int(input[input.startIndex + 2]) << 8 | Int(input[input.startIndex + 3])
    guard length > 0 && length <= maxFrameBody && input.count == length + 4 else { return frameError("frame_length") }
    let body = input.subdata(in: 4..<(length + 4))
    guard body.count >= 9, body.subdata(in: 0..<4) == helperMagic, body[4] == 1,
          let operation = [1: "create_key", 2: "public_key", 3: "sign", 4: "exists_key", 5: "delete_key", 16: "credential_load", 17: "credential_commit_exchange", 18: "credential_mark_refresh_pending", 19: "credential_commit_refresh", 20: "credential_delete", 32: "metadata_load", 33: "metadata_save", 34: "metadata_delete"][body[6]],
          body[5] == operationDomain(operation), body[7] == 1 else { return frameError("protocol_error") }
    wireOperation = operation
    do {
        let fields = try parseTLV(body.subdata(in: 9..<body.count), max: maxFrame - 9)
        guard fields.count == Int(body[8]), exactFieldIDs(fields, operationRequestFields(operation)), let nsData = field(fields, 1), let namespace = String(data: nsData, encoding: .utf8), validNamespace(namespace) else { return frameError("request_header") }
        wireNamespace = namespace
        var request: [String: Any] = ["version": 1, "namespace": namespace, "operation": operation]
        var payload: [String: Any] = [:]
        if operation == "sign", let bytes = field(fields, 2) { payload["preimage_base64url"] = base64URL(bytes) }
        if operation == "credential_commit_exchange", let bytes = field(fields, 2), let record = decodeCredentialRecord(bytes, namespace: namespace) { payload["record"] = record }
        if operation == "credential_mark_refresh_pending", let bytes = field(fields, 2), let pending = decodePendingRecord(bytes) { payload["pending"] = pending }
        if operation == "credential_commit_refresh", let p = field(fields, 2), let r = field(fields, 3), let pending = decodePendingRecord(p), let record = decodeCredentialRecord(r, namespace: namespace) { payload["pending"] = pending; payload["record"] = record }
        if operation == "metadata_save", let bytes = field(fields, 2), let metadata = decodeMetadataRecord(bytes) { payload["metadata"] = metadata }
        if !payload.isEmpty { request["payload"] = payload }
        return request
    } catch { return frameError("protocol_error") }
}

func tlv(_ fields: [(UInt8, Data)]) -> Data {
    var output = Data(); for (id, bytes) in fields { output.append(id); var n = UInt16(bytes.count).bigEndian; withUnsafeBytes(of: &n) { output.append(contentsOf: $0) }; output.append(bytes) }; return output
}
func writeFrame(_ object: [String: Any]) {
    let ok = object["ok"] as? Bool ?? false
    var fields: [(UInt8, Data)] = []
    if !ok { let error = ((object["error"] as? [String: Any])?["code"] as? String ?? "protocol_error"); fields = [(250, Data(error.utf8))] }
    else if let result = object["result"] as? [String: Any] {
        if wireOperation == "exists_key" { fields = [(1, Data([result["exists"] as? Bool == true ? 1 : 0]))] }
        else if wireOperation == "create_key" || wireOperation == "public_key", let value = result["x963_base64url"] as? String, let data = decodeBase64URL(value) { fields = [(1, data)] }
        else if wireOperation == "sign", let value = result["signature_der_base64url"] as? String, let data = decodeBase64URL(value) { fields = [(1, data)] }
        else if wireOperation == "credential_load" { if let r = result["record"] as? [String: Any], let data = encodeCredentialRecord(r) { fields.append((1, data)) }; if let p = result["pending"] as? [String: Any], let data = encodePendingRecord(p) { fields.append((2, data)) } }
        else if wireOperation == "credential_mark_refresh_pending", let p = result["pending"] as? [String: Any], let data = encodePendingRecord(p) { fields = [(1, data)] }
        else if wireOperation == "metadata_load", let metadata = result["metadata"] as? [String: Any], let data = encodeMetadataRecord(metadata) { fields = [(1, data)] }
        else if result["deleted"] as? Bool == true { fields = [(1, Data([1]))] }
    }
    let body = helperMagic + Data([1, operationDomain(wireOperation), operationCode(wireOperation) ?? 0, 2, UInt8(fields.count)]) + tlv(fields)
    guard body.count <= maxFrameBody else { return }; var output = Data(); var length = UInt32(body.count).bigEndian; withUnsafeBytes(of: &length) { output.append(contentsOf: $0) }; output.append(body); FileHandle.standardOutput.write(output)
}

func namespaceTag(_ namespace: String) -> Data { Data("com.skillmap.device-auth.\(namespace)".utf8) }

func u64Data(_ value: Any?) -> Data? {
    guard let number = value as? NSNumber, number.int64Value >= 0 else { return nil }
    var big = UInt64(number.int64Value).bigEndian; return withUnsafeBytes(of: &big) { Data($0) }
}
func readU64Data(_ data: Data) -> NSNumber? {
    guard data.count == 8 else { return nil }; var value: UInt64 = 0; for byte in data { value = (value << 8) | UInt64(byte) }; guard value <= UInt64(Int64.max) else { return nil }; return NSNumber(value: Int64(value))
}
func asciiData(_ value: Any?, _ count: Int) -> Data? { guard let string = value as? String, string.utf8.count == count, string.unicodeScalars.allSatisfy({ $0.value < 128 }) else { return nil }; return Data(string.utf8) }
func utf8Data(_ value: Any?) -> Data? {
    guard let string = value as? String, let data = string.data(using: .utf8), String(data: data, encoding: .utf8) == string else { return nil }
    return data
}
func encodeMetadataRecord(_ metadata: [String: Any]) -> Data? {
    let names = ["deviceId", "verificationUri", "displayName", "platform", "connectorVersion"]
    let fields: [(UInt8, Data)] = names.enumerated().compactMap { index, name in
        guard let value = metadata[name], let bytes = utf8Data(value) else { return nil }
        return (UInt8(index + 1), bytes)
    }
    return tlv(fields)
}
func decodeMetadataRecord(_ data: Data) -> [String: Any]? {
    guard let fields = try? parseTLV(data, max: maxCredentialRecord - 8), fields.allSatisfy({ (1...5).contains(Int($0.id)) }) else { return nil }
    let names = ["deviceId", "verificationUri", "displayName", "platform", "connectorVersion"]
    var metadata: [String: Any] = [:]
    for field in fields {
        guard let value = String(data: field.bytes, encoding: .utf8) else { return nil }
        metadata[names[Int(field.id) - 1]] = value
    }
    return validMetadata(metadata) ? metadata : nil
}
func encodePendingRecord(_ pending: [String: Any]) -> Data? {
    guard let idempotency = asciiData(pending["idempotencyKey"], 22), let digest = asciiData(pending["requestDigest"], 71), let wire = asciiData(pending["wireVersion"], 2), let response = asciiData(pending["responseVersion"], 2), let generation = u64Data(pending["expectedGeneration"]), let started = u64Data(pending["requestStartedAt"]) else { return nil }
    let body = tlv([(1, idempotency), (2, digest), (3, wire), (4, response), (5, generation), (6, started)]); var header = Data("SKPN".utf8); header.append(contentsOf: [1, 6]); var total = UInt16(8 + body.count).bigEndian; withUnsafeBytes(of: &total) { header.append(contentsOf: $0) }; return header + body
}
func decodePendingRecord(_ data: Data) -> [String: Any]? {
    guard data.count >= 8, data.subdata(in: 0..<4) == Data("SKPN".utf8), data[4] == 1, Int(data[5]) == 6, Int(data[6]) << 8 | Int(data[7]) == data.count else { return nil }
    guard let fields = try? parseTLV(data.subdata(in: 8..<data.count), max: maxCredentialRecord - 8), fields.count == 6, let id = field(fields, 1), let digest = field(fields, 2), let wire = field(fields, 3), let response = field(fields, 4), let generationData = field(fields, 5), let startedData = field(fields, 6), let generation = readU64Data(generationData), let started = readU64Data(startedData), let idString = String(data: id, encoding: .utf8), let digestString = String(data: digest, encoding: .utf8), let wireString = String(data: wire, encoding: .utf8), let responseString = String(data: response, encoding: .utf8) else { return nil }
    return ["idempotencyKey": idString, "requestDigest": digestString, "wireVersion": wireString, "responseVersion": responseString, "expectedGeneration": generation, "requestStartedAt": started]
}
func encodeCredentialRecord(_ record: [String: Any]) -> Data? {
    guard let device = asciiData(record["deviceId"], 22), let family = asciiData(record["tokenFamilyId"], 36), let refresh = asciiData(record["refreshToken"], 43), let generation = u64Data(record["generation"]), let absolute = u64Data(record["familyAbsoluteExpiresAt"]), let updated = u64Data(record["updatedAt"]), let scopes = record["scopes"] as? [String], scopes.count <= 255 else { return nil }
    var scopeData = Data([UInt8(scopes.count)]); for scope in scopes { let bytes = Data(scope.utf8); guard bytes.count <= 65535 else { return nil }; var n = UInt16(bytes.count).bigEndian; withUnsafeBytes(of: &n) { scopeData.append(contentsOf: $0) }; scopeData.append(bytes) }
    guard let origin = (record["originSha256"] as? Data), origin.count == 32, let tag = (record["applicationTagSha256"] as? Data), tag.count == 32, let suiteString = record["proofSuite"] as? String, suiteString == "p256-sha256" else { return nil }
    let suite = Data(suiteString.utf8); var fields: [(UInt8, Data)] = [(1, origin), (2, suite), (3, tag), (4, device)]
    if let value = record["devicePublicId"] as? String, let data = asciiData(value, 36) { fields.append((5, data)) }
    if let value = record["accountPublicId"] as? String, let data = asciiData(value, 37) { fields.append((6, data)) }
    fields.append((7, family)); fields.append((8, generation)); fields.append((9, absolute)); fields.append((10, refresh))
    if let pending = record["pending"] as? [String: Any], let data = encodePendingRecord(pending) { fields.append((11, data)) }
    fields.append((12, scopeData)); fields.append((13, updated)); let body = tlv(fields); guard body.count + 8 <= maxCredentialRecord else { return nil }; var header = Data("SKCR".utf8); header.append(contentsOf: [1, UInt8(fields.count)]); var total = UInt16(body.count + 8).bigEndian; withUnsafeBytes(of: &total) { header.append(contentsOf: $0) }; return header + body
}
func decodeCredentialRecord(_ data: Data, namespace: String = "skillmap.device-auth.v1") -> [String: Any]? {
    guard data.count >= 8, data.count <= maxCredentialRecord, data.subdata(in: 0..<4) == credentialMagic, data[4] == 1, Int(data[6]) << 8 | Int(data[7]) == data.count else { return nil }
    guard let fields = try? parseTLV(data.subdata(in: 8..<data.count), max: maxCredentialRecord - 8), exactFieldIDs(fields, fields.map(\.id).sorted()), fields.map(\.id).contains(1), fields.map(\.id).contains(2), fields.map(\.id).contains(3), let origin = field(fields, 1), origin.count == 32, let suite = field(fields, 2), String(data: suite, encoding: .utf8) == "p256-sha256", let tag = field(fields, 3), tag.count == 32, let device = field(fields, 4), let family = field(fields, 7), let refresh = field(fields, 10), let generationData = field(fields, 8), let absoluteData = field(fields, 9), let updatedData = field(fields, 13), let generation = readU64Data(generationData), let absolute = readU64Data(absoluteData), let updated = readU64Data(updatedData), let scopeData = field(fields, 12), let deviceString = String(data: device, encoding: .utf8), let familyString = String(data: family, encoding: .utf8), let refreshString = String(data: refresh, encoding: .utf8) else { return nil }
    var scopes: [String] = []; var offset = 1; guard !scopeData.isEmpty else { return nil }; for _ in 0..<Int(scopeData[0]) { guard offset + 2 <= scopeData.count else { return nil }; let n = Int(scopeData[offset]) << 8 | Int(scopeData[offset + 1]); offset += 2; guard offset + n <= scopeData.count, let scope = String(data: scopeData.subdata(in: offset..<(offset + n)), encoding: .utf8) else { return nil }; scopes.append(scope); offset += n }; guard offset == scopeData.count else { return nil }
    var record: [String: Any] = ["deviceId": deviceString, "tokenFamilyId": familyString, "refreshToken": refreshString, "scopes": scopes, "updatedAt": updated, "generation": generation, "familyAbsoluteExpiresAt": absolute, "originSha256": origin, "proofSuite": "p256-sha256", "applicationTagSha256": tag]
    guard origin == Data(SHA256.hash(data: Data("origin:\(namespace)".utf8))), tag == Data(SHA256.hash(data: Data("com.skillmap.device-auth.\(namespace)".utf8))) else { return nil }
    if let value = field(fields, 5), let string = String(data: value, encoding: .utf8) { record["devicePublicId"] = string }; if let value = field(fields, 6), let string = String(data: value, encoding: .utf8) { record["accountPublicId"] = string }; if let value = field(fields, 11), let pending = decodePendingRecord(value) { record["pending"] = pending }; return record
}

func encodeEnvelope(_ envelope: [String: Any], namespace: String) -> Data? {
    var fields: [(UInt8, Data)] = []
    if var record = envelope["record"] as? [String: Any] {
        // Pending is an envelope field, never duplicated inside the record.
        record.removeValue(forKey: "pending")
        guard validCredentialRecord(record, namespace: namespace) else { return nil }
        guard let recordData = encodeCredentialRecord(record) else { return nil }
        fields.append((1, recordData))
    }
    if let pending = envelope["pending"] as? [String: Any] {
        guard let pendingData = encodePendingRecord(pending) else { return nil }
        fields.append((2, pendingData))
    }
    if let metadata = envelope["metadata"] as? [String: Any] {
        guard validMetadata(metadata), let metadataData = encodeMetadataRecord(metadata) else { return nil }
        fields.append((3, metadataData))
    }
    guard !fields.isEmpty else { return nil }
    let body = tlv(fields)
    guard body.count + 8 <= maxCredentialRecord else { return nil }
    var header = envelopeMagic
    header.append(contentsOf: [1, UInt8(fields.count)])
    var total = UInt16(body.count + 8).bigEndian
    withUnsafeBytes(of: &total) { header.append(contentsOf: $0) }
    return header + body
}

func decodeEnvelope(_ data: Data, namespace: String) -> [String: Any]? {
    guard data.count >= 8, data.count <= maxCredentialRecord,
          data.subdata(in: 0..<4) == envelopeMagic, data[4] == 1,
          let fields = try? parseTLV(data.subdata(in: 8..<data.count), max: maxCredentialRecord - 8),
          fields.count == Int(data[5]), exactFieldIDs(fields, fields.map(\.id).sorted()),
          fields.allSatisfy({ [1, 2, 3].contains(Int($0.id)) }),
          Int(data[6]) << 8 | Int(data[7]) == data.count else { return nil }
    var envelope: [String: Any] = [:]
    if let recordData = field(fields, 1), let record = decodeCredentialRecord(recordData, namespace: namespace) { envelope["record"] = record }
    else if field(fields, 1) != nil { return nil }
    if let pendingData = field(fields, 2), let pending = decodePendingRecord(pendingData) { envelope["pending"] = pending }
    else if field(fields, 2) != nil { return nil }
    if let metadataData = field(fields, 3), let metadata = decodeMetadataRecord(metadataData) { envelope["metadata"] = metadata }
    else if field(fields, 3) != nil { return nil }
    return envelope.isEmpty ? nil : envelope
}

func keyQuery(_ namespace: String, returnRef: Bool = false) -> [CFString: Any] {
    var query: [CFString: Any] = [
        kSecClass: kSecClassKey,
        kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrApplicationTag: namespaceTag(namespace),
    ]
    if returnRef { query[kSecReturnRef] = true }
    return query
}

func key(_ namespace: String) -> (SecKey?, OSStatus) {
    var item: CFTypeRef?
    let status = SecItemCopyMatching(keyQuery(namespace, returnRef: true) as CFDictionary, &item)
    if let item, CFGetTypeID(item) == SecKeyGetTypeID() { return (unsafeBitCast(item, to: SecKey.self), status) }
    return (nil, status)
}

func publicKeyResult(_ privateKey: SecKey) -> [String: Any]? {
    guard let publicKey = SecKeyCopyPublicKey(privateKey), let bytes = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else { return nil }
    return ["x963_base64url": base64URL(bytes)]
}

func credentialQuery(_ namespace: String) -> [CFString: Any] {
    // We intentionally use the weaker local-login generic-password model:
    // there is no Team ID, access group, provisioning, or DP-keychain claim.
    [kSecClass: kSecClassGenericPassword, kSecAttrService: "com.skillmap.device-auth.\(namespace)", kSecAttrAccount: "credential-v1", kSecAttrSynchronizable: false]
}

func validMetadata(_ metadata: [String: Any]) -> Bool {
    let allowed = Set(["deviceId", "verificationUri", "displayName", "platform", "connectorVersion"])
    guard Set(metadata.keys).isSubset(of: allowed), let deviceId = metadata["deviceId"] as? String,
          deviceId.range(of: "^[A-Za-z0-9_-]{22}$", options: .regularExpression) != nil,
          let verificationUri = metadata["verificationUri"] as? String,
          verificationUri.count <= 2048, !verificationUri.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) else { return false }
    if !verificationUri.isEmpty {
        guard let url = URL(string: verificationUri), let scheme = url.scheme, (scheme == "http" || scheme == "https"), url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return false }
    }
    if let displayName = metadata["displayName"] as? String, displayName.count > 64 || displayName.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) { return false }
    if metadata["displayName"] != nil && metadata["displayName"] as? String == nil { return false }
    if let connectorVersion = metadata["connectorVersion"] as? String, connectorVersion.count > 128 || connectorVersion.range(of: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$", options: .regularExpression) == nil { return false }
    if metadata["connectorVersion"] != nil && metadata["connectorVersion"] as? String == nil { return false }
    if let platform = metadata["platform"] as? String, !["macos", "windows", "linux"].contains(platform) { return false }
    if metadata["platform"] != nil && metadata["platform"] as? String == nil { return false }
    return true
}

// Each helper invocation is a separate process. Serialize credential
// envelope read-modify-write operations with a same-user, 0600 lock file.
// The filename contains only the closed, non-secret namespace grammar.
func withCredentialLock(_ namespace: String, _ body: () -> [String: Any]) -> [String: Any] {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("SkillMap", isDirectory: true)
    let locks = support.appendingPathComponent("locks", isDirectory: true)
    let manager = FileManager.default
    func realDirectory(_ path: String) -> Bool {
        var st = Darwin.stat()
        return lstat(path, &st) == 0 && (st.st_mode & S_IFMT) == S_IFDIR
            && st.st_uid == geteuid() && (st.st_mode & 0o777) == 0o700 && st.st_nlink >= 2
    }
    do {
        if manager.fileExists(atPath: support.path) && !realDirectory(support.path) { return frameError("credential_lock_timeout") }
        if manager.fileExists(atPath: locks.path) && !realDirectory(locks.path) { return frameError("credential_lock_timeout") }
        try manager.createDirectory(at: locks, withIntermediateDirectories: true, attributes: [FileAttributeKey.posixPermissions: 0o700])
        guard realDirectory(support.path), realDirectory(locks.path) else { return frameError("credential_lock_timeout") }
    } catch { return frameError("credential_lock_timeout") }
    let path = locks.appendingPathComponent("skillmap-device-auth-\(namespace).lock").path
    var descriptor: Int32 = -1
    let deadline = Date().addingTimeInterval(10)
    repeat {
        descriptor = open(path, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        var stat = Darwin.stat()
        let ownedRegular = descriptor >= 0 && fstat(descriptor, &stat) == 0 && (stat.st_mode & S_IFMT) == S_IFREG && stat.st_uid == geteuid() && stat.st_nlink == 1 && (stat.st_mode & 0o777) == 0o600
        if descriptor >= 0 && !ownedRegular { close(descriptor); descriptor = -1; return frameError("credential_lock_timeout") }
        if descriptor >= 0 && flock(descriptor, LOCK_EX | LOCK_NB) == 0 { break }
        if descriptor >= 0 { close(descriptor); descriptor = -1 }
        usleep(10_000)
    } while Date() < deadline
    guard descriptor >= 0 else { return frameError("credential_lock_timeout") }
    defer {
        flock(descriptor, LOCK_UN)
        close(descriptor)
    }
    return body()
}

func loadEnvelope(_ namespace: String) -> (value: [String: Any]?, status: OSStatus, corrupt: Bool) {
    var query = credentialQuery(namespace)
    query[kSecReturnData] = true
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return (nil, status, false) }
    guard status == errSecSuccess else { return (nil, status, false) }
    guard let data = item as? Data else { return (nil, status, true) }
    guard let envelope = decodeEnvelope(data, namespace: namespace) else { return (nil, errSecDecode, true) }
    return (envelope, errSecSuccess, false)
}

func saveEnvelope(_ namespace: String, _ envelope: [String: Any]) -> Bool {
    guard let data = encodeEnvelope(envelope, namespace: namespace), data.count <= maxCredentialRecord else { return false }
    let update = SecItemUpdate(credentialQuery(namespace) as CFDictionary, [kSecValueData: data] as CFDictionary)
    if update == errSecSuccess { return true }
    if update != errSecItemNotFound { return false }
    var attrs: [CFString: Any] = [kSecValueData: data, kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecAttrSynchronizable: false]
    attrs[kSecClass] = kSecClassGenericPassword
    attrs[kSecAttrService] = "com.skillmap.device-auth.\(namespace)"
    attrs[kSecAttrAccount] = "credential-v1"
    return SecItemAdd(attrs as CFDictionary, nil) == errSecSuccess
}

func validCredentialRecord(_ record: [String: Any], namespace: String, requireM308: Bool = true) -> Bool {
    let allowed: Set<String> = ["deviceId", "tokenFamilyId", "refreshToken", "scopes", "devicePublicId", "accountPublicId", "updatedAt", "generation", "familyAbsoluteExpiresAt", "originSha256", "proofSuite", "applicationTagSha256"]
    guard Set(record.keys).isSubset(of: allowed) else { return false }
    guard let deviceId = record["deviceId"] as? String, !deviceId.isEmpty,
          let family = record["tokenFamilyId"] as? String, !family.isEmpty,
          let refresh = record["refreshToken"] as? String, !refresh.isEmpty,
          let scopes = record["scopes"] as? [Any], scopes.allSatisfy({ $0 is String }),
          let updated = record["updatedAt"] as? NSNumber, updated.int64Value >= 0 else { return false }
    guard let origin = record["originSha256"] as? Data, origin == Data(SHA256.hash(data: Data("origin:\(namespace)".utf8))),
          let tag = record["applicationTagSha256"] as? Data, tag == Data(SHA256.hash(data: Data("com.skillmap.device-auth.\(namespace)".utf8))),
          record["proofSuite"] as? String == "p256-sha256" else { return false }
    if requireM308 {
        guard let generation = record["generation"] as? NSNumber, generation.int64Value >= 0,
              let absolute = record["familyAbsoluteExpiresAt"] as? NSNumber, absolute.int64Value > 0,
              deviceId.range(of: "^[A-Za-z0-9_-]{22}$", options: .regularExpression) != nil,
              family.range(of: "^fam_[0-9a-f]{32}$", options: .regularExpression) != nil,
              refresh.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { return false }
    }
    if let devicePublic = record["devicePublicId"] as? String {
        if devicePublic.range(of: "^dev_[0-9a-f]{32}$", options: .regularExpression) == nil { return false }
    } else if record["devicePublicId"] != nil { return false }
    if let accountPublic = record["accountPublicId"] as? String {
        if accountPublic.range(of: "^acct_[0-9a-f]{32}$", options: .regularExpression) == nil { return false }
    } else if record["accountPublicId"] != nil { return false }
    if let generation = record["generation"] as? NSNumber, generation.int64Value < 0 { return false }
    if let absolute = record["familyAbsoluteExpiresAt"] as? NSNumber, absolute.int64Value <= 0 { return false }
    return true
}

func validPending(_ pending: [String: Any]) -> Bool {
    let allowed: Set<String> = ["idempotencyKey", "requestDigest", "wireVersion", "responseVersion", "expectedGeneration", "requestStartedAt"]
    guard Set(pending.keys).isSubset(of: allowed) else { return false }
    guard let idempotency = pending["idempotencyKey"] as? String,
          idempotency.range(of: "^[A-Za-z0-9_-]{22}$", options: .regularExpression) != nil,
          let digest = pending["requestDigest"] as? String,
          digest.range(of: "^sha256:[0-9a-f]{64}$", options: .regularExpression) != nil,
          let wire = pending["wireVersion"] as? String, wire == "v1",
          let response = pending["responseVersion"] as? String, response == "v1",
          let generation = pending["expectedGeneration"] as? NSNumber, generation.int64Value >= 0,
          let started = pending["requestStartedAt"] as? NSNumber, started.int64Value >= 0 else { return false }
    return true
}

func pendingMatches(_ a: [String: Any], _ b: [String: Any]) -> Bool {
    guard validPending(a), validPending(b) else { return false }
    return (a["idempotencyKey"] as? String) == (b["idempotencyKey"] as? String)
        && (a["requestDigest"] as? String) == (b["requestDigest"] as? String)
        && (a["wireVersion"] as? String) == (b["wireVersion"] as? String)
        && (a["responseVersion"] as? String) == (b["responseVersion"] as? String)
        && (a["expectedGeneration"] as? NSNumber)?.int64Value == (b["expectedGeneration"] as? NSNumber)?.int64Value
        && (a["requestStartedAt"] as? NSNumber)?.int64Value == (b["requestStartedAt"] as? NSNumber)?.int64Value
}

func validCredentialEnvelope(_ envelope: [String: Any], namespace: String = "skillmap.device-auth.v1") -> Bool {
    let allowed: Set<String> = ["record", "pending", "metadata"]
    guard Set(envelope.keys).isSubset(of: allowed) else { return false }
    if let record = envelope["record"] as? [String: Any], !validCredentialRecord(record, namespace: namespace) { return false }
    if envelope["record"] != nil && !(envelope["record"] is [String: Any]) { return false }
    if let pending = envelope["pending"] as? [String: Any], !validPending(pending) { return false }
    if let pending = envelope["pending"], !(pending is NSNull) && !(pending is [String: Any]) { return false }
    if let metadata = envelope["metadata"] as? [String: Any], !validMetadata(metadata) { return false }
    if envelope["metadata"] != nil && !(envelope["metadata"] is [String: Any]) { return false }
    return true
}

let request = readFrame()
guard request["version"] as? Int == 1,
      let namespace = request["namespace"] as? String, validNamespace(namespace),
      let operation = request["operation"] as? String else {
    writeFrame(frameError("request_header")); exit(0)
}
let payload = request["payload"] as? [String: Any] ?? [:]
var response: [String: Any]

switch operation {
case "exists_key":
    let found = key(namespace)
    if found.1 == errSecSuccess && found.0 != nil { response = frameSuccess(["exists": true]) }
    else if found.1 == errSecSuccess { response = frameError("key_query_failed") }
    else if found.1 == errSecItemNotFound { response = frameSuccess(["exists": false]) }
    else { response = frameError("key_query_failed") }
case "create_key":
    let existingKey = key(namespace)
    if existingKey.1 != errSecSuccess && existingKey.1 != errSecItemNotFound { response = frameError("key_query_failed")
    } else if let existing = existingKey.0, let result = publicKeyResult(existing) {
        response = frameSuccess(result)
    } else if existingKey.1 == errSecSuccess { response = frameError("key_public_failed")
    } else {
        let privateAttributes: [CFString: Any] = [
            kSecAttrIsPermanent: true,
            kSecAttrApplicationTag: namespaceTag(namespace),
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecPrivateKeyAttrs: privateAttributes,
        ]
        var error: Unmanaged<CFError>?
        if let generated = SecKeyCreateRandomKey(attributes as CFDictionary, &error), let result = publicKeyResult(generated) {
            response = frameSuccess(result)
        } else { response = frameError("key_create_failed") }
    }
case "public_key":
    let found = key(namespace)
    if found.1 == errSecItemNotFound { response = frameError("not_found") }
    else if found.1 != errSecSuccess { response = frameError("key_query_failed") }
    else if let privateKey = found.0, let result = publicKeyResult(privateKey) { response = frameSuccess(result) }
    else { response = frameError("key_public_failed") }
case "sign":
    guard let encoded = payload["preimage_base64url"] as? String, let message = decodeBase64URL(encoded) else { response = frameError("request_payload"); break }
    let found = key(namespace)
    if found.1 == errSecItemNotFound { response = frameError("not_found"); break }
    if found.1 != errSecSuccess { response = frameError("key_query_failed"); break }
    guard let privateKey = found.0 else { response = frameError("key_query_failed"); break }
    var error: Unmanaged<CFError>?
    if let signature = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256, message as CFData, &error) as Data? {
        response = frameSuccess(["signature_der_base64url": base64URL(signature)])
    } else { response = frameError("sign_failed") }
case "delete_key":
    let keyStatus = SecItemDelete(keyQuery(namespace) as CFDictionary)
    if keyStatus == errSecSuccess || keyStatus == errSecItemNotFound { response = frameSuccess(["deleted": true]) }
    else { response = frameError("key_delete_failed") }
case "credential_load":
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("credential_corrupt") }
        if loaded.status != errSecSuccess && loaded.status != errSecItemNotFound { return frameError("credential_query_failed") }
        if let envelope = loaded.value, !validCredentialEnvelope(envelope, namespace: namespace) { return frameError("credential_corrupt") }
        var result: [String: Any] = [:]
        if let envelope = loaded.value, let record = envelope["record"] { result["record"] = record }
        if let envelope = loaded.value, let pending = envelope["pending"] { result["pending"] = pending }
        return frameSuccess(result)
    }
case "credential_commit_exchange":
    guard let record = payload["record"] as? [String: Any], validCredentialRecord(record, namespace: namespace) else { response = frameError("record_invalid"); break }
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("credential_corrupt") }
        if loaded.status != errSecSuccess && loaded.status != errSecItemNotFound { return frameError("credential_query_failed") }
        if let envelope = loaded.value, !validCredentialEnvelope(envelope, namespace: namespace) { return frameError("credential_corrupt") }
        var envelope = loaded.value ?? [:]
        envelope["record"] = record
        envelope["pending"] = NSNull()
        return saveEnvelope(namespace, envelope) ? frameSuccess() : frameError("credential_write_failed")
    }
case "credential_mark_refresh_pending":
    guard let pending = payload["pending"] as? [String: Any], validPending(pending) else { response = frameError("pending_invalid"); break }
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("credential_corrupt") }
        if loaded.status != errSecSuccess { return loaded.status == errSecItemNotFound ? frameError("not_found") : frameError("credential_query_failed") }
        if let envelope = loaded.value, !validCredentialEnvelope(envelope, namespace: namespace) { return frameError("credential_corrupt") }
        var envelope = loaded.value ?? [:]
        guard let record = envelope["record"] as? [String: Any], validCredentialRecord(record, namespace: namespace),
              let generation = record["generation"] as? NSNumber,
              let expected = pending["expectedGeneration"] as? NSNumber,
              generation.int64Value == expected.int64Value else { return frameError("credential_generation_conflict") }
        if let existing = envelope["pending"] as? [String: Any] {
            return pendingMatches(existing, pending) ? frameSuccess(["pending": existing]) : frameError("credential_pending_conflict")
        }
        envelope["pending"] = pending
        return saveEnvelope(namespace, envelope) ? frameSuccess(["pending": pending]) : frameError("credential_write_failed")
    }
case "credential_commit_refresh":
    guard let pending = payload["pending"] as? [String: Any], validPending(pending),
          let nextRecord = payload["record"] as? [String: Any], validCredentialRecord(nextRecord, namespace: namespace) else { response = frameError("record_invalid"); break }
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("credential_corrupt") }
        if loaded.status != errSecSuccess { return loaded.status == errSecItemNotFound ? frameError("not_found") : frameError("credential_query_failed") }
        if let envelope = loaded.value, !validCredentialEnvelope(envelope, namespace: namespace) { return frameError("credential_corrupt") }
        var envelope = loaded.value ?? [:]
        guard let current = envelope["record"] as? [String: Any], validCredentialRecord(current, namespace: namespace),
              let currentGeneration = current["generation"] as? NSNumber,
              let expected = pending["expectedGeneration"] as? NSNumber,
              let nextGeneration = nextRecord["generation"] as? NSNumber,
              nextGeneration.int64Value == expected.int64Value + 1 else { return frameError("credential_generation_conflict") }
        let noPending = envelope["pending"] == nil || envelope["pending"] is NSNull
        if currentGeneration.int64Value == nextGeneration.int64Value && (current["refreshToken"] as? String) == (nextRecord["refreshToken"] as? String) && noPending { return frameSuccess() }
        guard let storedPending = envelope["pending"] as? [String: Any], pendingMatches(storedPending, pending), currentGeneration.int64Value == expected.int64Value else { return frameError("credential_commit_conflict") }
        if let oldAbsolute = current["familyAbsoluteExpiresAt"] as? NSNumber, let nextAbsolute = nextRecord["familyAbsoluteExpiresAt"] as? NSNumber, oldAbsolute.int64Value != nextAbsolute.int64Value { return frameError("credential_family_expiry_conflict") }
        envelope["record"] = nextRecord
        envelope["pending"] = NSNull()
        return saveEnvelope(namespace, envelope) ? frameSuccess() : frameError("credential_write_failed")
    }
case "credential_delete":
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("credential_corrupt") }
        if loaded.status != errSecSuccess && loaded.status != errSecItemNotFound { return frameError("credential_query_failed") }
        if let envelope = loaded.value, !validCredentialEnvelope(envelope, namespace: namespace) { return frameError("credential_corrupt") }
        var envelope = loaded.value ?? [:]
        envelope.removeValue(forKey: "record")
        envelope.removeValue(forKey: "pending")
        if envelope["metadata"] != nil {
            return saveEnvelope(namespace, envelope) ? frameSuccess(["deleted": true]) : frameError("credential_delete_failed")
        }
        let status = SecItemDelete(credentialQuery(namespace) as CFDictionary)
        return (status == errSecSuccess || status == errSecItemNotFound) ? frameSuccess(["deleted": true]) : frameError("credential_delete_failed")
    }
case "metadata_load":
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("metadata_corrupt") }
        if loaded.status != errSecSuccess && loaded.status != errSecItemNotFound { return frameError("metadata_query_failed") }
        guard let metadataValue = loaded.value?["metadata"] else { return frameSuccess() }
        guard let metadata = metadataValue as? [String: Any], validMetadata(metadata) else { return frameError("metadata_corrupt") }
        return frameSuccess(["metadata": metadata])
    }
case "metadata_save":
    guard let metadata = payload["metadata"] as? [String: Any], validMetadata(metadata) else { response = frameError("metadata_shape"); break }
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("metadata_corrupt") }
        if loaded.status != errSecSuccess && loaded.status != errSecItemNotFound { return frameError("metadata_query_failed") }
        if let envelope = loaded.value, !validCredentialEnvelope(envelope, namespace: namespace) { return frameError("metadata_corrupt") }
        var envelope = loaded.value ?? [:]
        envelope["metadata"] = metadata
        return saveEnvelope(namespace, envelope) ? frameSuccess() : frameError("metadata_write_failed")
    }
case "metadata_delete":
    response = withCredentialLock(namespace) {
        let loaded = loadEnvelope(namespace)
        if loaded.corrupt { return frameError("metadata_corrupt") }
        if loaded.status != errSecSuccess && loaded.status != errSecItemNotFound { return frameError("metadata_query_failed") }
        if let envelope = loaded.value, !validCredentialEnvelope(envelope, namespace: namespace) { return frameError("metadata_corrupt") }
        var envelope = loaded.value ?? [:]
        envelope.removeValue(forKey: "metadata")
        let hasRecord = envelope["record"] != nil
        let hasPending = envelope["pending"] != nil && !(envelope["pending"] is NSNull)
        if hasRecord || hasPending {
            return saveEnvelope(namespace, envelope) ? frameSuccess(["deleted": true]) : frameError("metadata_delete_failed")
        }
        let status = SecItemDelete(credentialQuery(namespace) as CFDictionary)
        return (status == errSecSuccess || status == errSecItemNotFound) ? frameSuccess(["deleted": true]) : frameError("metadata_delete_failed")
    }
default:
    response = frameError("unknown_operation")
}

writeFrame(response)
