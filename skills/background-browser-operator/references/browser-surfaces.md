# Browser Surface Routing

Use the least disruptive browser surface that can prove the claim.

## In-App Browser

Use for isolated checks:

- local web apps
- unauthenticated pages
- screenshots and responsive inspection
- manual-step preparation
- temporary browser evidence where account state is not required

Do not claim authenticated, live, or profile-specific verification from this surface unless that state was directly available and observed.

## Chrome, Comet, Or Profile Browser

Use when the user's real browser state is the target:

- installed browser extensions
- logged-in account pages
- ChatGPT/Comet automations
- profile-specific settings
- workflows where cookies/session state matter

State the profile/session assumption. Stop for 2FA, CAPTCHA, payment, destructive account settings, or sensitive personal data.

## Computer-Use

Use only when browser-specific tools cannot reach the UI, such as OS-level browser chrome, extension menus, native dialogs, or inaccessible app surfaces.

Computer-use is more likely to steal focus. State that risk before acting when the user is studying or meeting.

## Manual Handoff

Use when automation should not continue safely:

- auth or re-authentication
- CAPTCHA
- 2FA
- payment or billing
- destructive account actions
- privacy-sensitive content
- unclear user intent

Open or identify the target first when feasible, then provide ordered steps.

