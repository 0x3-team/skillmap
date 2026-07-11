# External onboarding pilot runbook

This runbook is for the five external onboarding pilots required before a public developer beta. A blank template is not pilot evidence, and no pilot is complete until a real operator performs the workflow on the exact candidate tarball.

## Candidate freeze

Record before recruiting a participant:

- candidate version, commit, and tarball SHA-256;
- operating system, architecture, Node version, and package-manager version;
- `npm pack --dry-run` and clean-consumer-install results;
- telemetry state (`off` by default);
- known limitations and support contact;
- confirmation that no global hook or skill-root mutation is part of the pilot.

Use the same candidate for all five pilots unless a blocking defect requires a new candidate. If it changes, record the new digest and restart the affected comparison.

## Participant workflow

Start a 15-minute timer when the participant begins the first command.

1. Install the supplied local tarball in a clean temporary project.
2. Run `skillmap --help`, then `skillmap dashboard`.
3. Open the one-time loopback URL printed by the command.
4. Create or select a local workspace.
5. Validate and explicitly approve one skill root.
6. Run scan and structural doctor from the guided onboarding screen.
7. Review any duplicate/policy blocker; do not force a green state.
8. Import or prepare a reviewed eval suite. Demo/synthetic evidence must remain labeled as such.
9. Classify every approved source as reviewed local-authored or a specific GitHub repository/subtree/ref, then run Sources Check; do not interpret zero records as clean coverage.
10. Apply the reviewed policy revision and rebuild the graph after the last canonical source/eval mutation.
11. Run the approved eval suite and verify its evidence label remains truthful.
12. Run two materially different Route Lab prompts and verify that the result changes or safely abstains.
13. Record one structured feedback outcome.
14. Stop the dashboard and confirm the foreground connector exits cleanly.

The facilitator may explain wording but should not type paths, edit `.skillmap` artifacts, or repair the workflow for the participant. Record any intervention.

## Redacted receipt

Record only:

- anonymous pilot ID;
- candidate digest and environment versions;
- time to first approved route or safe abstention;
- last completed step;
- number and duration of facilitator interventions;
- blocker codes and screen/command names;
- whether any unexpected network request, prompt retention, path exposure, global mutation, or serious accessibility issue occurred;
- participant verdict: completed, completed with help, or blocked.

Do not collect raw prompts, skill bodies, absolute paths, secrets, hook text, or private screenshots. Store free-form notes outside the product evidence packet unless they have been manually redacted.

## Beta gate

The recommended gate is:

- at least four of five new operators reach a trusted route within 15 minutes;
- no P1 defect or pilot-blocking P2 remains;
- no silent root or global-hook mutation occurs;
- held-out natural eval and privacy gates pass on the candidate;
- every failure has an owner and reproducible machine code.

Report the pilot gate separately from local validation, hosted CI, npm publication, and deployment. Passing this runbook does not authorize publishing or tagging.

## Cleanup

The participant stops the foreground dashboard, removes the temporary consumer project if desired, and follows the uninstall instructions. SkillMap does not remove approved source roots. Any project-local hook installed later through an explicit separate exercise must be removed with `skillmap hook uninstall codex` and verified in the target hook file.
