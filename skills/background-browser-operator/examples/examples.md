# Background Browser Operator Examples

## Study-Safe Browser Monitor

User: "I'm studying. Keep checking the Comet automation in the background and tell me if I need to act."

Expected behavior:

- Treat studying as the foreground task.
- Use the browser surface that contains the Comet automation if available.
- Avoid stealing focus unless the user explicitly asks.
- Stop for auth, 2FA, CAPTCHA, or sensitive account actions.
- Close with the background browser status receipt.

## Frontend Verification While User Works Elsewhere

User: "Use frontend-design and verify the page in a browser, but don't interrupt me."

Expected behavior:

- Let `frontend-design` own UI judgment.
- Use this skill for the browser lane.
- Prefer an isolated browser for local UI checks.
- Record screenshots, viewport, URL, and whether focus was interrupted.

## Manual Account Handoff

User: "Open the billing settings and tell me exactly what to do."

Expected behavior:

- Open or identify the account target when feasible.
- Stop before payment, destructive, or credential-sensitive actions.
- Provide ordered manual steps.
- State what evidence the user should report back.

