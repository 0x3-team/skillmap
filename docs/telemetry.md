# Telemetry decision

SkillMap telemetry is off in the experimental local alpha.

- The CLI and `skillmap dashboard` do not send product analytics, prompts, skill bodies, paths, route events, job receipts, or workspace metadata to SkillMap-operated infrastructure.
- The local connector binds to `127.0.0.1`. Its API and static UI are same-origin; source checks contact only the operator-configured upstream provider.
- Redacted route events are retained locally for at most 90 days and 10,000 records. Write-time admission enforces the cap even when Activity is never opened. Feedback is stored only as one immutable receipt per route/outcome (at most four per retained route), uses a hashed idempotency key, and is pruned with its route. Operators may remove the local event directory sooner.
- Default safe export is an explicit, allowlisted, shareable-redacted action. Local-sensitive export requires a different flag, acknowledgement, and confined destination.
- No collected material is used for model training.

Public-beta telemetry remains an owner decision. If introduced later, it must be opt-in, schema-allowlisted, documented field by field, revocable, deletion-capable, and independently covered by privacy tests. Until that decision is approved, external pilot evidence must be gathered through deliberate redacted exports or written operator feedback.
