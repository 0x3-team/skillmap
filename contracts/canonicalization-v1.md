# SkillMap Canonical JSON v1

SkillMap contract digests use the following deterministic projection.

1. Accept only JSON values: `null`, booleans, finite numbers, strings, arrays, and plain objects.
2. Normalize negative zero to zero.
3. Preserve array order.
4. Sort object keys by JavaScript UTF-16 code-unit order and recurse into every value.
5. Preserve own keys such as `__proto__`; inherited properties never participate.
6. Serialize the result with `JSON.stringify` and no insignificant whitespace.
7. For a contract `payloadDigest`, omit only the top-level keys `payloadDigest`, `transportDigest`, and `transportMetadata` before canonicalization. Equally named nested keys are not omitted.
8. Hash the UTF-8 canonical bytes with SHA-256 and prefix the lowercase hex digest with `sha256:`.

Contract-specific semantic digests declare their projection in the corresponding schema `$comment`. Self-digest, timestamps, latency, and transport metadata must never be included unless the contract explicitly says otherwise.

Changing this algorithm requires a new canonicalization version and new digest-bearing contract versions.
