# software-orchestrator

Goal-mode Software Orchestrator skill (v0.3.0).

## Setup

```bash
python scripts/initialize_store.py --path store/orchestrator.db
python scripts/seed_model_priors.py --db store/orchestrator.db --force
```

## Invoke

```text
/software-orchestrator
# attach plan/doc — runs until coverage complete
```

See `SKILL.md` and `references/`.
