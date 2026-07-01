# Contributing

SkillMap is currently private alpha software. Contributions should preserve the core safety model:

- deterministic CLI behavior first
- native agent curation second
- no hook installation without explicit user action
- no deletion or mutation of source skills by default
- no broad filesystem scanning beyond configured skill roots

## Local setup

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## Pull request quality bar

A change should include:

- a clear problem statement
- focused implementation scope
- fixture coverage for parser, policy, doctor, graph, route, or eval behavior when relevant
- updated docs for user-visible commands or safety semantics
- validation output from `npm run typecheck` and `npm test`

## Design principles

- Raw inventory is audit truth.
- Effective graph is routing truth.
- Policy should be reversible.
- Route traces should explain recommendations and exclusions.
- Runtime hooks must stay compact and deterministic.
