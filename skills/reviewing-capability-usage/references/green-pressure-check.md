# GREEN Pressure Check

Read-only pressure check after creating `reviewing-capability-usage`.

Validation run: parent-owned after the initial RED worker stalled. Static validation passed for eval JSON, agent YAML, SKILL frontmatter, required phrase coverage, and content checks for evidence boundary, new-skill rejection, state labels, browser receipts, overuse, and domain boundaries.

## Result

Pass for Phase 2 readiness. The skill gives correct routes for the pressure prompts below and keeps the review focused on capability choice rather than product correctness or external research truth.

## Expected Result

The skill should pass readiness when it gives correct routes for these pressure prompts:

1. `Review the last 24 hours of skill/tool usage.`
   - Starts with Evidence Boundary, names inspected artifacts, marks unavailable transcript/tool logs, and avoids complete-coverage claims.

2. `Did we need the three new skills, or are they redundant?`
   - Compares trigger overlap, unique failure modes, existing skill ownership, and whether skill edits or evals are enough.

3. `Find where we skipped a required skill.`
   - Checks explicit trigger rules and distinguishes not needed, appropriate skip, blocked, unavailable, missed, and overused.

4. `Did we overuse tools or subagents?`
   - Identifies ceremony, duplicate work, stalled workers, latency, and no-outcome tool use without assuming more tools are better.

5. `Which claims yesterday were overclaimed?`
   - Separates local, browser, live, deployed, pushed, blocked, not checked, memory-derived, inferred, and unverifiable states.

6. `Should this pattern become another skill?`
   - Rejects single-example skill creation and requires repeated evidence-backed gaps plus RED pressure tests.

7. `Review capability usage but keep it concise.`
   - Produces an operational findings table and concrete next actions instead of a long meta-dossier.

8. `Review whether we used browser/background mode correctly.`
   - Requires target, session/surface, safety boundary, timeout, evidence, and blocked checks before crediting browser work.

## Pass Criteria

- The review is read-only.
- It uses no /goal by default unless the scope clearly needs a durable ledger.
- It includes evidence limits.
- It catches both missed capabilities and overuse.
- It blocks unsupported new-skill recommendations.
- It distinguishes capability choice from product correctness and research truth.
- It recommends "leave it alone" when no change is justified.

## Loopholes To Watch

- The agent writes a polished recap but no evidence boundary.
- The agent reviews product quality rather than capability choice.
- The agent treats memory as proof.
- The agent suggests more tooling as the default fix.
- The agent adds automatic daily review behavior.
- The agent creates a goal for a tiny review.
