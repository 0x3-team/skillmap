import Darwin
import Foundation

enum HelperFailure: Error {
    case malformedRequest
}

func decodePath(_ data: Data, offset: inout Int) throws -> String {
    guard data.count - offset >= 4 else { throw HelperFailure.malformedRequest }
    let length = data[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    offset += 4
    guard length > 0, length <= 32_768, data.count - offset >= Int(length) else {
        throw HelperFailure.malformedRequest
    }
    let bytes = data[offset..<(offset + Int(length))]
    offset += Int(length)
    guard !bytes.contains(0), let value = String(data: bytes, encoding: .utf8), value.hasPrefix("/") else {
        throw HelperFailure.malformedRequest
    }
    return value
}

do {
    let request = FileHandle.standardInput.readDataToEndOfFile()
    var offset = 0
    let source = try decodePath(request, offset: &offset)
    let destination = try decodePath(request, offset: &offset)
    guard offset == request.count else { throw HelperFailure.malformedRequest }

    let sourceParent = (source as NSString).deletingLastPathComponent
    let sourceLeaf = (source as NSString).lastPathComponent
    let destinationParent = (destination as NSString).deletingLastPathComponent
    let destinationLeaf = (destination as NSString).lastPathComponent
    guard !sourceLeaf.isEmpty, !destinationLeaf.isEmpty,
          !sourceLeaf.contains("/"), !destinationLeaf.contains("/") else {
        throw HelperFailure.malformedRequest
    }

    let sourceDirectory = open(sourceParent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard sourceDirectory >= 0 else { throw HelperFailure.malformedRequest }
    defer { close(sourceDirectory) }
    let destinationDirectory = open(destinationParent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard destinationDirectory >= 0 else { throw HelperFailure.malformedRequest }
    defer { close(destinationDirectory) }

    let result = sourceLeaf.withCString { sourcePointer in
        destinationLeaf.withCString { destinationPointer in
            renameatx_np(sourceDirectory, sourcePointer, destinationDirectory, destinationPointer, UInt32(RENAME_EXCL))
        }
    }
    if result == 0 {
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
} catch {
    FileHandle.standardOutput.write(Data("MALFORMED_REQUEST\n".utf8))
    exit(64)
}
