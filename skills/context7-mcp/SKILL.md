---
name: context7-mcp
description: Use when the task depends on current documentation for a library, framework, SDK, API, CLI tool, cloud service, setup/configuration, version migration, or platform-specific behavior. Prefer Context7 when available; fall back to official docs or source repos when Context7 is unavailable or weak.
---

# Context7 MCP

Use Context7 for current technical documentation instead of relying on model memory when the answer depends on a library, framework, SDK, API, CLI, cloud service, platform setup, configuration option, version migration, or code example whose behavior may have changed.

This is an on-demand documentation router. Do not load docs for general programming concepts, repo-specific business logic, ordinary code review, or refactors where local source truth is enough.

## When To Use

Use this skill when the user:

- Asks setup or configuration questions, such as "How do I configure Next.js middleware?"
- Requests code that depends on a library API, such as a Prisma query or Supabase auth flow.
- Needs API, CLI, SDK, framework, or cloud-provider reference behavior.
- Mentions a version-specific framework or package, such as React 19, Next.js 16, Tailwind 4, Prisma 6, or Wrangler.
- Hits an error that may be caused by changed platform behavior, deprecated options, migration rules, or current docs.
- Asks for current best practice for a specific package, service, or platform.

Skip this skill when:

- The question is pure business logic, architecture, refactoring, testing strategy, or general programming.
- The needed truth is in local source files, generated types, schemas, tests, logs, database rows, or runtime output.
- The only available query would require sending secrets, private customer data, proprietary source blobs, or long private snippets.
- The package behavior is already pinned and verified by local docs/tests, and external docs would not change the answer.

## Privacy Boundary

Never send the following to Context7:

- API keys, tokens, passwords, cookies, headers, private URLs, account IDs, or credential names.
- Customer data, patient data, payment data, private emails, or direct personal identifiers.
- Proprietary source files, long private snippets, private prompts, or internal documents.
- `.env` contents, config secrets, auth headers, or database connection strings.

Sanitize the question. Send only the package/platform name, version when relevant, public error shape, and the narrow technical question.

## Workflow

1. Identify the library, SDK, API, CLI, framework, or cloud service.
2. Detect the version from local source when it is cheap and relevant:
   - JavaScript/TypeScript: `package.json`, lockfiles, framework config.
   - Python: `pyproject.toml`, `requirements.txt`, lockfiles.
   - Go: `go.mod`.
   - Rust: `Cargo.toml`.
   - Ruby: `Gemfile`.
   - Platform CLIs: config files, lockfiles, package manager metadata, or local `--version` output when safe.
3. Resolve the Context7 library ID unless the user already supplied a valid `/org/project` or `/org/project/version` ID.
4. Select the best match by exact name, official/high-reputation source, version match, snippet coverage, and relevance to the task.
5. Query docs with a narrow task-specific question.
6. Use no more than three Context7 documentation queries for one user question before falling back to the best available source.
7. If Context7 is unavailable, ambiguous, or low quality, use official docs, source repositories, standards, or runtime evidence instead.
8. In the answer or implementation notes, distinguish:
   - `verified from current docs`
   - `verified from local source/runtime`
   - `inferred`
   - `not verified`

## Tool Contract

Use the Context7 MCP tools in this order:

1. `resolve_library_id`
   - `libraryName`: official package/platform name when known.
   - `query`: the sanitized user question and relevant version/context.
2. `query_docs`
   - `libraryId`: selected Context7-compatible ID.
   - `query`: a narrow question that avoids secrets and private code.

When multiple good matches exist, prefer the official or primary project. If the version the user asks about appears in the result list, use the version-specific ID.

## Closeout

When this skill materially affects the answer or implementation, include a compact note:

```text
Docs: Context7 <libraryId> used for <question>; version <version or unknown>; fallback <none or source>.
```

Do not over-quote documentation. Summarize the relevant rule and cite the source/tool result when the answer depends on it.
