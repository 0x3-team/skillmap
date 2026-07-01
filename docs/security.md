# Security Notes

SkillMap treats installed skills as untrusted local metadata.

## What SkillMap reads

- `SKILL.md` frontmatter and body size
- skill paths and roots
- presence of `scripts/`, `references/`, and `assets/`
- local `.skillmap` policy/eval files

## What SkillMap does not do

- execute skill scripts
- upload skill content
- call an LLM
- call the network
- delete source skills
- install hooks without an explicit command

## Hook boundary

The Codex hook adapter is passive. It emits compact route context through `UserPromptSubmit` and does not block or rewrite prompts. Install defaults to project-local `.codex/hooks.json`; `--global` is deliberate opt-in.

Codex may load matching hooks from multiple sources. Review installed hooks with `/hooks` and trust only definitions you recognize.

## Sensitive data

Doctor packs can contain local filesystem paths and skill descriptions. Do not paste them into untrusted external services unless you are comfortable exposing that metadata.
