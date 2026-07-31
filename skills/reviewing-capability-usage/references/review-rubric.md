# Capability Review Rubric

Score each material capability decision from 0 to 5. Use evidence-backed judgment; do not average scores mechanically when one severe miss should dominate the verdict.

| Dimension | 0 | 3 | 5 |
| --- | --- | --- | --- |
| Trigger fit | Required skill/tool missed | Reasonable but implicit | Correct capability invoked and stated |
| Evidence boundary | Overclaimed coverage | Some evidence, gaps noted | Exact sources and limits stated |
| Outcome value | Tool use added no value | Helped somewhat | Materially improved result |
| Overhead control | Ceremony or duplicate work | Acceptable cost | Leanest sufficient capability |
| Stage discipline | Research, planning, implementation, and validation blurred | Mostly separated | Stage gates and artifacts preserved |
| Personalization | Generic Codex behavior | Some user preferences used | User-specific standards clearly applied |
| Native superiority | No better than native | Some improvement | Clearly beats native with receipts or evals |

## Fit Labels

- `correct use`: capability matched the request and improved evidence or outcome.
- `missed capability`: available capability should have been used and the omission created risk or extra work.
- `appropriate skip`: capability was available but unnecessary for the scope.
- `blocked`: capability was right but auth, permissions, tool state, env, context, or access prevented use.
- `unavailable`: capability did not exist in the session or could not be loaded.
- `overused`: capability added latency, cost, or ceremony without material value.
- `misused`: capability was used for the wrong purpose or used as proof it cannot provide.

## Native Superiority Standard

Native Codex behavior is not the bar. Skid capability usage should be better by:

- stating evidence boundaries first
- selecting the smallest sufficient capability set
- using skills when triggers match
- separating local, browser, live, deployed, pushed, blocked, and not checked states
- preserving research, planning, implementation, and validation gates
- using user-specific standards instead of generic recaps
- recommending concrete skill edits, evals, automation, or no action

## Scoring Guidance

High score:

- evidence inspected is named exactly
- missing evidence is disclosed
- skill/tool use changed the result
- subagents or browser lanes had a concrete reason
- a new-skill verdict is based on repeated evidence

Low score:

- review depends on memory alone
- more tools are treated as automatically better
- missed trigger rules are ignored
- one anecdote becomes a global skill recommendation
- product correctness is reviewed instead of capability choice

