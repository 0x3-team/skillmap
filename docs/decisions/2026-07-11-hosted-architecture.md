# ADR: Hosted Library Architecture

Date: 2026-07-11
Status: accepted for staged implementation

## Decision

Build the online SkillMap library now as a separate hosted trust plane while preserving the existing local-first runtime.

- Supabase owns hosted authentication, relational data, explicit public projections, RLS, and account state.
- GitHub OAuth through Supabase is the launch login. Anonymous catalog reads remain available without login.
- Next.js is the web/API application; Vercel is the preferred host, but remote project creation, region, plan, domain, and spend require explicit owner approval.
- The local CLI/connector remains the authority for local inventory, prompt-private routing, policy, and workspace history.
- Later package/index distribution uses content addressing plus the SkillMap TUF profile; graders and workers write separate signed receipts.
- The launch is free. No Stripe, checkout, entitlement, subscription, metering, or payment tables/API are part of the architecture.

## Rationale

An online catalog removes the practical distribution/testing barrier of a local-only product and gives accounts an immediate purpose through saved skills. Separating hosted identity/evidence from local runtime prevents Supabase sessions or cloud availability from becoming prerequisites for private local routing. Truthful phased evidence avoids presenting metadata seeds as packaged, audited, compatible, or graded skills.

## Consequences

- Hosted and local identifiers remain separate; no migration of `sk_...` is implied.
- Public payloads are shared contracts, while the database implementation remains private behind an explicit `api` schema.
- Missing backend configuration is a visible unavailable state; fixtures never back hosted routes.
- Remote infrastructure and live OAuth are not proven by local Supabase/Playwright acceptance.
- Package, ingestion/update, audit/advisory, grading, router/plugin, publisher/operator, corpus-coverage, and launch phases remain real future work.
- Any later billing proposal requires a separate pricing, Stripe, privacy, threat-model, schema, and implementation decision.

## Alternatives considered

- Local-only launch: rejected because recruiting external testers and delivering a usable catalog would remain unnecessarily difficult.
- One cloud application replacing local runtime: rejected because it weakens prompt privacy, offline operation, and deterministic local policy.
- Public-repository CI workaround: rejected after the organization chose a professional private repository; private CI requires an explicit Actions budget instead of visibility toggling.
- Billing in the foundation: rejected because the product is free and billing would add risk without validating the core workflow.
