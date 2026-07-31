# Session lessons (audit v1.1)

## Closed-graph examples

Standalone example tasks must not reference missing hard_dependencies. Ship a mini-corpus that validates as a DAG.

## Honest readiness

Never label READY without running structural + coverage + cycle + granularity gates (`scripts/check_readiness.py`).

## Goal-mode

Attached PRD/handoff = standing goal: write shards and audit until READY/CONDITIONALLY_READY; partial outlines are not exits.

## Authorship

Original package design is the user's; revisions are audit/hardening only — preserve useful structure.

## Dual install

Hermes `skills/software-development/` + `~/.grok/skills/` when user wants global Grok+Hermes access; Telegram zip optional for portability.
