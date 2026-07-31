# Safety Guide

## Protected by Default

Do not propose deleting these unless the user explicitly names them and confirms the consequence:

- Codex history, runs, logs, prompts, workspaces, and `.codex` data.
- User-created documents, photos, videos, music projects, design files, source repositories, notes, and exports.
- Password/keychain data, browser profiles, mail databases, messages, calendars, contacts, and iCloud/Photos library internals.
- App databases under `~/Library/Application Support` unless the app and data purpose are clear.
- System folders: `/System`, `/Library`, `/Applications`, `/private/var`, `/usr`, `/bin`, `/sbin`.

## Low-Risk Patterns

Usually safe after review:

- App caches in `~/Library/Caches`.
- Logs in `~/Library/Logs`.
- Trash contents.
- Xcode DerivedData.
- Package-manager caches.
- Build output directories such as `dist`, `build`, `.next`, `.turbo`, `target`, `.pytest_cache`, `.mypy_cache`.
- Old `.dmg`, `.pkg`, `.zip`, `.tar.gz` installers in Downloads.

## Medium-Risk Patterns

Ask before deleting because regeneration may take time or local state may matter:

- `node_modules`.
- Docker images, volumes, and build cache.
- Xcode simulator devices and runtimes.
- Large downloads and exported media.
- Local AI model weights.
- Virtual environments and language toolchains.

## Cleanup Preference

Move personal or ambiguous files to `~/.Trash` instead of permanent deletion. Permanently delete only caches, logs, and generated artifacts after approval.
