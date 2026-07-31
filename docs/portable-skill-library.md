# Portable skill library

SkillMap carries a source-pinned library of Agent Skills under `skills/`. Every mirrored directory contains `SKILL.md`, follows the open Agent Skills folder format, and is indexed in `catalog/skill-library.json` with immutable upstream coordinates and file digests.

The generated library currently contains 153 skills. `cloudflare` and `pentest-tools` remain metadata-only exclusions: the former exceeds Lovable's 200-file package limit; the latter contains a file larger than Lovable's 1 MB limit and has an unresolved Windows Defender inspection block.

Mirrored means packaged and integrity-indexed, not behaviorally trusted. Every
entry is marked `review.status=unreviewed`, automatic use is not recommended by
default, and script-bearing packages are identified in the manifest. Review a
skill before importing or enabling it; catalog validation never executes
bundled scripts.

## Lovable

Lovable imports one skill directory at a time. In **Settings → Skills → Add → Import from GitHub**, paste a public subdirectory URL:

```text
https://github.com/0x3-team/skillmap/tree/main/skills/supabase
```

List or emit URLs from the checkout:

```bash
npm run skills:install -- --list
npm run skills:install -- --target lovable --skill supabase
npm run skills:install -- --target lovable --skill all --json
```

Lovable only accepts public GitHub repositories for URL imports. `0x3-team/skillmap` is private at the time this library was built, so these URLs become usable only after an explicit repository-visibility decision. Until then, copy a single `skills/<name>` directory into a ZIP with `SKILL.md` at the archive root or inside one wrapping folder and use Lovable's **Upload ZIP** flow.

Generate deterministic, manifest-verified ZIPs directly:

```bash
npm run skills:export-lovable -- --skill supabase --output artifacts/lovable-skills
npm run skills:export-lovable -- --skill all --output artifacts/lovable-skills
```

## Local coding tools

Preview an installation:

```bash
npm run skills:install -- --target agents --skill all --dry-run
npm run skills:install -- --target codex --skill supabase --dry-run
npm run skills:install -- --target claude --skill supabase --dry-run
npm run skills:install -- --target copilot --scope project --skill supabase --dry-run
npm run skills:install -- --target cursor --scope project --skill supabase --dry-run
```

Apply an installation by removing `--dry-run`. Existing skill directories are skipped unless `--force` is supplied. Forced updates move the previous directory to a timestamped sibling backup before activating the replacement.

Default destinations:

| Target | Global | Project |
| --- | --- | --- |
| Agents-compatible | `~/.agents/skills` | `.agents/skills` |
| Codex | `~/.codex/skills` | `.agents/skills` |
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| GitHub Copilot / VS Code | `~/.copilot/skills` | `.github/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |

Use `--target custom --dest PATH` for another compatible host.

## Rebuild and verify

`skill-sources.lock.json` is the provenance authority. After reviewing and copying a newer immutable upstream snapshot:

```bash
npm run skills:build
npm run skills:check
npm run test:skills
```

Do not edit generated `catalog/skill-library.json` manually. Do not run scripts bundled inside imported skills as part of catalog generation or validation.
