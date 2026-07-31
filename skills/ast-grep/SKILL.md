---
name: ast-grep
description: Use for AST-aware code search, syntax-shaped matching, codemods, API migrations, repeated structured edits, or refactors where text grep may overmatch or miss language structure.
---

# AST Grep

Use AST-aware search when the question is about code shape, not just text. `rg` remains the default for plain strings; `ast-grep` is for syntax.

## When To Use

Use this skill when:

- Finding call sites by syntactic shape.
- Searching for imports, JSX props, function calls, decorators, object patterns, assignments, or API usage.
- Planning or applying a mechanical codemod.
- Refactoring repeated code structures across files.
- Avoiding false positives from comments, strings, generated files, or unrelated identifiers.

Skip this skill when:

- A simple `rg` or `rg --files` query answers the question.
- The language is unsupported or the repo lacks enough files for AST matching to pay off.
- The task needs semantic call flow or impact analysis; use `codegraph` first when available.

## Workflow

1. Define the code shape in words before writing the pattern.
2. Start with `rg` or `rg --files` if needed to identify languages and candidate directories.
3. Choose the language/parser explicitly when the tool requires it.
4. Test the AST pattern on a small scope first.
5. Inspect matches before changing files.
6. For codemods:
   - run a dry run or JSON/listing mode first.
   - apply changes to the narrowest safe file set.
   - inspect the diff.
   - run tests/typecheck/lint relevant to the changed language.

## Pattern Discipline

- Prefer concrete syntax over broad wildcards.
- Exclude generated/build/vendor directories.
- Avoid matching comments and strings unless that is the target.
- Keep replacement patterns minimal.
- If the pattern is brittle, stop and use manual edits or CodeGraph-assisted navigation.

## Tool Notes

Common command shapes:

```bash
ast-grep --lang ts -p '<pattern>' <path>
ast-grep --lang tsx -p '<pattern>' <path>
ast-grep --lang js -p '<pattern>' <path>
```

Use the installed tool's help output for exact flags. Some versions differ on JSON, rewrite, and update flags.

## Guardrails

- Do not apply a codemod without inspecting candidate matches.
- Do not run broad rewrites over the whole home directory or unrelated workspaces.
- Do not treat a clean AST search as proof of runtime behavior.
- Preserve unrelated user changes.

## Closeout

```text
AST-grep:
- Shape searched:
- Scope:
- Matches:
- Changes applied:
- Validation:
```
