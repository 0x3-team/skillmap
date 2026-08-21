import Darwin
import Foundation

enum HelperFailure: Error {
    case malformedRequest
    case rootCapabilityStale
    case sourceIdentityStale
    case unsafePath
}

func decodeField(_ data: Data, offset: inout Int) throws -> String {
    guard data.count - offset >= 4 else { throw HelperFailure.malformedRequest }
    let length = data[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    offset += 4
    guard length > 0, length <= 32_768, data.count - offset >= Int(length) else {
        throw HelperFailure.malformedRequest
    }
    let bytes = data[offset..<(offset + Int(length))]
    offset += Int(length)
    guard !bytes.contains(0), let value = String(data: bytes, encoding: .utf8) else {
        throw HelperFailure.malformedRequest
    }
    return value
}

func decodeIdentity(_ data: Data, offset: inout Int) throws -> UInt64 {
    let value = try decodeField(data, offset: &offset)
    guard !value.isEmpty, value.allSatisfy({ $0.isASCII && $0.isNumber }), let result = UInt64(value) else {
        throw HelperFailure.malformedRequest
    }
    return result
}

func relativeComponents(_ value: String) throws -> [String] {
    guard !value.isEmpty,
          !value.hasPrefix("/"),
          !value.contains("\\"),
          value.precomposedStringWithCanonicalMapping == value else {
        throw HelperFailure.malformedRequest
    }
    let components = value.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    guard !components.isEmpty else { throw HelperFailure.malformedRequest }
    for component in components {
        guard !component.isEmpty, component != ".", component != "..",
              !component.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) else {
            throw HelperFailure.malformedRequest
        }
    }
    return components
}

func openBoundRoot(_ path: String, expectedDevice: UInt64, expectedInode: UInt64) throws -> Int32 {
    guard path.hasPrefix("/") else { throw HelperFailure.malformedRequest }
    let descriptor = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard descriptor >= 0 else { throw HelperFailure.rootCapabilityStale }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          UInt64(metadata.st_dev) == expectedDevice,
          UInt64(metadata.st_ino) == expectedInode else {
        close(descriptor)
        throw HelperFailure.rootCapabilityStale
    }
    return descriptor
}

func openParent(
    rootDescriptor: Int32,
    relativePath: String,
    createParents: Bool
) throws -> (descriptor: Int32, leaf: String) {
    var components = try relativeComponents(relativePath)
    let leaf = components.removeLast()
    var current = dup(rootDescriptor)
    guard current >= 0 else { throw HelperFailure.unsafePath }

    do {
        for component in components {
            if createParents {
                let createResult = component.withCString { mkdirat(current, $0, mode_t(0o700)) }
                if createResult != 0 && errno != EEXIST { throw HelperFailure.unsafePath }
            }
            let next = component.withCString { openat(current, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW) }
            guard next >= 0 else { throw createParents ? HelperFailure.unsafePath : HelperFailure.sourceIdentityStale }
            close(current)
            current = next
        }
        return (current, leaf)
    } catch {
        close(current)
        throw error
    }
}

func observeSource(
    parentDescriptor: Int32,
    leaf: String,
    expectedDevice: UInt64,
    expectedInode: UInt64
) throws {
    var metadata = stat()
    let result = leaf.withCString { fstatat(parentDescriptor, $0, &metadata, AT_SYMLINK_NOFOLLOW) }
    guard result == 0,
          (metadata.st_mode & S_IFMT) != S_IFLNK,
          UInt64(metadata.st_dev) == expectedDevice,
          UInt64(metadata.st_ino) == expectedInode else {
        throw HelperFailure.sourceIdentityStale
    }
}

func destinationIsOccupied(parentDescriptor: Int32, leaf: String) throws -> Bool {
    var metadata = stat()
    let result = leaf.withCString { fstatat(parentDescriptor, $0, &metadata, AT_SYMLINK_NOFOLLOW) }
    if result == 0 { return true }
    if errno == ENOENT { return false }
    throw HelperFailure.unsafePath
}

do {
    let request = FileHandle.standardInput.readDataToEndOfFile()
    var offset = 0
    guard try decodeField(request, offset: &offset) == "2" else { throw HelperFailure.malformedRequest }
    let sourceRootPath = try decodeField(request, offset: &offset)
    let sourceRelativePath = try decodeField(request, offset: &offset)
    let sourceRootDevice = try decodeIdentity(request, offset: &offset)
    let sourceRootInode = try decodeIdentity(request, offset: &offset)
    let sourceObjectDevice = try decodeIdentity(request, offset: &offset)
    let sourceObjectInode = try decodeIdentity(request, offset: &offset)
    let destinationRootPath = try decodeField(request, offset: &offset)
    let destinationRelativePath = try decodeField(request, offset: &offset)
    let destinationRootDevice = try decodeIdentity(request, offset: &offset)
    let destinationRootInode = try decodeIdentity(request, offset: &offset)
    guard offset == request.count else { throw HelperFailure.malformedRequest }

    let sourceRoot = try openBoundRoot(
        sourceRootPath,
        expectedDevice: sourceRootDevice,
        expectedInode: sourceRootInode
    )
    defer { close(sourceRoot) }
    let destinationRoot = try openBoundRoot(
        destinationRootPath,
        expectedDevice: destinationRootDevice,
        expectedInode: destinationRootInode
    )
    defer { close(destinationRoot) }

    let source = try openParent(
        rootDescriptor: sourceRoot,
        relativePath: sourceRelativePath,
        createParents: false
    )
    defer { close(source.descriptor) }
    let destination = try openParent(
        rootDescriptor: destinationRoot,
        relativePath: destinationRelativePath,
        createParents: true
    )
    defer { close(destination.descriptor) }

    try observeSource(
        parentDescriptor: source.descriptor,
        leaf: source.leaf,
        expectedDevice: sourceObjectDevice,
        expectedInode: sourceObjectInode
    )
    if try destinationIsOccupied(parentDescriptor: destination.descriptor, leaf: destination.leaf) {
        FileHandle.standardOutput.write(Data("DESTINATION_OCCUPIED\n".utf8))
        exit(17)
    }

    let result = source.leaf.withCString { sourcePointer in
        destination.leaf.withCString { destinationPointer in
            renameatx_np(
                source.descriptor,
                sourcePointer,
                destination.descriptor,
                destinationPointer,
                UInt32(RENAME_EXCL)
            )
        }
    }
    if result == 0 {
        _ = fsync(source.descriptor)
        _ = fsync(destination.descriptor)
        FileHandle.standardOutput.write(Data("OK\n".utf8))
        exit(0)
    }
    switch errno {
    case EEXIST:
        FileHandle.standardOutput.write(Data("DESTINATION_OCCUPIED\n".utf8))
        exit(17)
    case EXDEV:
        FileHandle.standardOutput.write(Data("CROSS_VOLUME\n".utf8))
        exit(18)
    default:
        FileHandle.standardOutput.write(Data("FAILED\n".utf8))
        exit(1)
    }
} catch HelperFailure.rootCapabilityStale {
    FileHandle.standardOutput.write(Data("ROOT_CAPABILITY_STALE\n".utf8))
    exit(65)
} catch HelperFailure.sourceIdentityStale {
    FileHandle.standardOutput.write(Data("SOURCE_IDENTITY_STALE\n".utf8))
    exit(66)
} catch HelperFailure.unsafePath {
    FileHandle.standardOutput.write(Data("UNSAFE_PATH\n".utf8))
    exit(67)
} catch {
    FileHandle.standardOutput.write(Data("MALFORMED_REQUEST\n".utf8))
    exit(64)
}
