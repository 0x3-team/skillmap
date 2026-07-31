# Capability store

SQLite DB is generated locally (not committed).

```bash
python scripts/initialize_store.py --path store/orchestrator.db
python scripts/seed_model_priors.py --db store/orchestrator.db --force
```
