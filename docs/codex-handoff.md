# Codex Handoff: skillmap

## Project Identity

- Local path: /Users/stevmq/Documents/Codex/2026-07-01/wha/work/skillmap
- Intended GitHub repo: https://github.com/Masih-0x3/skillmap
- Production or live URL: UNKNOWN - local tool/repo scope, no deployed URL confirmed
- Owner/account: Masihhedayati
- Priority: P2
- Migration complexity: B dirty (tracked/untracked changes present)

- Local branch migrated to: migration/unknown--skillmap-2026-07-04
- Linode destination branch: migration/unknown--skillmap-2026-07-04

## Current State

- What this project does: Local-first skill discovery and tooling helper for Codex-style skill workflows (CLI and reporting commands).
- Current branch: main
- Current HEAD: 7d68b14770ba2bccf024bce740db46b33a9e10b2
- Dirty tracked files: 11
- Untracked files: 4
- Known active task: Preserve and migrate local changes before moving/copying from Mac.

## How To Run

- Install command: npm install
- Dev command: npm run build
- Test command: npm run test
- Build command: npm run build
- Deploy command: UNKNOWN - not a deployed app/service

## External Services

- GitHub: https://github.com/Masih-0x3/skillmap
- Cloudflare: UNKNOWN
- Vercel: UNKNOWN
- Supabase: UNKNOWN
- Other: UNKNOWN

## Required Secrets

- Secret names only, no values: UNKNOWN
- Where secrets should live after migration: provider-specific secret manager if added later; none observed in repo.

## Local-Only Context

- Important old Codex threads: not copied; summarize in this handoff and project ledger notes.
- Local notes: none identified.
- Non-Git artifacts: none identified as required beyond normal project source.
- Known caveats: dirty working tree and untracked files; no destructive actions yet.

## Migration Notes

- GitHub preservation plan: stage approved files only; avoid `git add .`; create migration branch only if dirty files are approved.
- Linode validation plan: clone from preserved commit/branch, run `npm install` then `npm run build` and `npm run test` (both defined in `package.json`).
- Archive decision: pending user approval after preservation and Linode validation.
- Blockers: dirty working tree and untracked source files require user decision before commit.
