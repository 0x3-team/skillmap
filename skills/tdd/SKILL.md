---
name: tdd
description: Use test-driven development when the user asks for test-first work, red-green-refactor, integration tests, or when a requested implementation touches business logic, data integrity, auth, payments, scheduling, migrations, or a bug that needs a regression test. Prefer existing repo test tools and keep the loop focused.
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification - "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

**Tautological tests** restate the implementation inside the assertion, so they pass by construction and give zero confidence. When the expected value is computed the way the code computes it — `expect(add(a, b)).toBe(a + b)`, snapshotting a figure you derived by hand the same way the code does, asserting a constant equals itself — the test can never disagree with the code: break the code wrong and the assertion breaks wrong with it. The expected value must come from an independent source of truth — a known-good literal, a worked example, the spec.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Local Codex use

Use TDD selectively. It is a high-confidence loop for risky behavior, not a ritual for every edit.

Use this skill by default when:

- The user explicitly asks for test-first work.
- A bug has a reproducible symptom and a correct regression seam.
- The change affects business rules, data contracts, auth, billing, scoring, scheduling, migrations, queues, or other high-blast-radius behavior.
- The repo already has a test framework and a focused test can exercise the behavior through a public interface.

Do not force TDD for copy edits, simple styling, one-off scripts, purely visual polish, docs-only changes, generated assets, or tiny mechanical refactors. For those, use the repo's normal validation and, for UI, rendered browser checks.

Action-first rule: if the user has asked for implementation and the behavior can be inferred safely from repo context, state the first test slice briefly and proceed. Ask only when the public interface, acceptance behavior, or test scope cannot be inferred and the wrong choice would be costly.

For bugs, pair this with root-cause discipline: capture red evidence before the fix when feasible, turn the minimal repro into a regression test at the right seam, then make the original path green.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" - treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

When exploring the codebase, read `CONTEXT.md` (if it exists) so that test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

Before writing any code:

- [ ] Anchor the existing public interface or user workflow from local code, docs, routes, tests, or runtime evidence.
- [ ] Identify the smallest behavior slice that proves the path end-to-end.
- [ ] Identify opportunities for deep modules (small interface, deep implementation) when the current shape blocks a good test.
- [ ] List the behaviors to test (not implementation steps)
- [ ] Ask the user only if the behavior or interface choice cannot be inferred safely.

You can't test everything. Focus testing effort on critical paths, complex logic, and the behavior most likely to regress. Do not add a new test framework unless the user explicitly asks for that tooling change.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet - proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for [refactor candidates](refactoring.md):

- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Apply SOLID principles where natural
- [ ] Consider what new code reveals about existing code
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Expected values are independent literals, not recomputed from the code
[ ] Code is minimal for this test
[ ] No speculative features added
```
