# SkillMap Release Ledger

Append-only release-boundary receipts. Each row proves only the scopes it names; a source or CI receipt is never deployment or live-product proof.

| Recorded (UTC) | Candidate | Release tree | Merged `main` | Evidence | Status boundary |
| --- | --- | --- | --- | --- | --- |
| 2026-07-13 | `67129297d08f7f7bc88800015b336a2a7bb1b139` | `3a70dbafca99153ad80d67601a5b2e3bbc2d47d5` | `29a356a9b809d29ff8c986fbd5a0af78d87e479c` | Gitea candidate run `44` passed; GitHub Actions run `29285742074`, JIT hosted-web job `86937705880`, passed for that scope only; post-merge Gitea `main` run `47` passed. Static `sha256:3dd68b69f5faad0e6cf70e03dbf98cedb735ed5661dc2c6a8d01c799ed7b2996`; database `sha256:ada2c9d819dce02a3b89971c44119eb96ef89f244ccd692439e80281f64056d1`. | Locally validated, pushed, merged, and scoped remote CI verified. Not deployed, not verified live, not publicly indexed, and not launched. `NO-GO`. |
