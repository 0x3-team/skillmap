---
name: diffui-designer
description: >-
  Runs the diffui MCP workflow before any HTML/CSS/JS is written: create_project,
  generate_options (4 variants), generate_page, create_build_link, then implement
  code from the build markdown. Auth (whoami/authenticate) only on tool errors —
  installs usually include DIFFUI_API_KEY already. REQUIRED when the user asks to
  create, build, or design a webpage, website, landing page, app screen, dashboard,
  or UI — including "create a webpage for …", "design first then build/create in …",
  themed sites (jungle, arctic, etc.), and output paths like demoBuild/. Do NOT
  skip diffui and design manually in prose or jump straight to coding when the
  diffui MCP server is available. Also use when the user mentions diffui.
---

# Diffui designer

You orchestrate diffui (an AI design-generation canvas) through its **MCP tools**.
The user sees all option images inline in the tool result. Follow this choreography.

## When this skill applies (required)

If the **diffui MCP server** is enabled and the user wants a new webpage or UI
look — even when they also name an output folder (`demoBuild/bongo`,
`demoBuild/svalbardLan`, etc.) — you **must** use diffui for the design phase.
Treat these as the same class of request:

- "Create a webpage for …"
- "Design a landing page …"
- "Design first, then create/build it in …"
- "Build a website for …" (when no existing diffui designs are referenced)

**Two phases — never merge them:**

1. **Design (diffui MCP)** — `create_project` →
   `generate_options` → pick/iterate → (optional `generate_page` for multi-page) →
   `create_build_link`.
2. **Implementation (code)** — write HTML/CSS/JS only **after** phase 1, following
   the build markdown from `create_build_link` into the user's target path.

**Minimal path (single landing page):** `generate_options` → user picks →
`create_build_link` → code. Do not require brand creation or extra `generate_page`
calls for a one-page request.

**Forbidden before `generate_options`:**

- Creating `index.html`, stylesheets, or app UI files
- Choosing colors, typography, and layout entirely from scratch
- "Designing conceptually" in prose instead of calling `generate_options`

**After `generate_options`:**

- **Default for Cursor, Codex, Claude, and most clients:** the tool result includes a `DOWNLOAD THESE IMAGES LOCALLY` block. Before your final reply: create a hidden `.diffui/` folder in the project's current working directory if it doesn't exist, add it to `.gitignore`, download each listed image into it under the given filename, then embed each one in your reply using its **resolved absolute local path** — never the remote URL, and never a `file://` URI. Put those image lines first. Do not replace them with summaries or descriptions. Descriptions may follow each image, but never omit the image lines.
- **Only for clients explicitly configured for inline image blocks:** the option images may already be returned as MCP image blocks. Still keep display URLs visible unless the host is known to render those blocks to the user.
- Set `DIFFUI_MCP_IMAGE_MODE=markdown` to opt back into embedding the remote URL directly instead of downloading locally (still renders in most hosts, just behind an extra click-through).
- Present options as **Option A–D** with the required image lines first and short visual descriptions after them
- Do NOT include imageIds, UUIDs, or other internal metadata in user-facing text
- Keep the imageId ledger from the assistant-only tool result block in your reasoning
- **Always wait for the user to pick** — present Option A–D and stop. Do not call
  `create_build_link`, `generate_page`, `generate_pages`, or write code until the user names
  a letter (or option image).
- **Never auto-select** an option based on your judgment, folder name, prompt fit, or phrases
  like "surprise me", "you choose", or "pick the best one". Those do not waive this step.
- Do not proceed to the next diffui step in the same turn as `generate_options`; end your
  response after presenting the options.

**Auth (reactive only):** Do not call `whoami` or `authenticate` before starting — the MCP
install usually includes credentials. If any tool returns not-authenticated, call
`authenticate` once, then retry. Do not silently fall back to hand-designed UI.

**Prompt writing:** Turn the user's request into a visual design prompt for
`generate_options` (audience, tone, sections, layout, color/mood). Each prompt
must describe **one complete screen**. `count: 4` already creates four separate
outputs, so never write “create four options/directions/variants,” enumerate
multiple visual routes, or ask for a grid/contact sheet/mood board. Use
`style_randomize: true` for varied outputs while keeping one shared direction.
For
`generate_page`, use the shortest prompt that fits — page name plus any
user-requested specifics only.

**Do not:**

- Skip diffui because you can write vanilla HTML/CSS/JS directly.
- "Design" in chain-of-thought or bullet lists instead of calling `generate_options`.
- Read `generate_options` tool docs and then decide to design manually.
- Start creating files in the target directory before diffui options exist.

**Only skip diffui** when the user explicitly says not to ("skip design", "no diffui",
"just code it"), for pure backend tasks, small non-visual edits, or they point you at
finished diffui designs / a build link with no new design work. If you skip, say so in
one sentence.

### Example triggers

| User says | You do first |
|---|---|
| Create a jungle-themed coffee shop page in `demoBuild/bongo` | diffui `generate_options`; code goes in `demoBuild/bongo` after build link |
| Design the page first, then create it in `demoBuild/svalbardLan` | diffui design phase — "design first" means MCP, not manual concept art |
| Build me a SaaS pricing page | diffui options → pages → build link → code |

## 0. Setup

1. For a new design session, call `create_project`. Reuse the same `project_id` for the
   whole session. Do **not** call `open_canvas` by default — inline tool images are enough
   inside Cursor/Claude/Codex. Only open the browser canvas if the user asks to watch there.
2. **Auth only on error.** Do not proactively call `whoami`. If a tool fails with
   not-authenticated, call `authenticate` — a browser window opens for one-click
   connect, or pass an API key from diffui → Settings → API as `api_key`. Then
   retry the failed call.

## 1. New design → 4 options

When the user describes a design they want:

- Call `generate_options` with `count: 4` and **no** `brand_id` (a fresh
  canvas auto-diversifies styles across the options, which is what you want).
- The tool returns full-res `displayUrl` per option, an assistant-only ledger JSON, and may also include inline MCP image blocks for explicitly opted-in clients.
  By default, including Cursor, Codex, and Claude, the tool result includes a `DOWNLOAD THESE IMAGES LOCALLY` block: download each option into a hidden `.diffui/` folder in the project's working directory (gitignored), then embed each one in your user-facing reply using its resolved absolute local path — never the remote URL, never a `file://` URI. Only explicitly configured inline-image clients should rely on MCP image blocks instead.
  Keep the `option → imageId` mapping in your reasoning — never paste ids into
  user-facing messages.
- After options return, present them as Option A–D with short descriptions and **stop** — do not
  call any other diffui tool or write code in the same turn.
- Offer three paths once the user has picked (or asks for more before picking): keep their choice,
  see more options (`generate_options` again, passing the same `prompt_node_id` to append), or mix
  elements of options (see "Generating with inputs").

## 2. Generating with inputs

`generate_with_inputs` handles any request where existing images should
shape the result. Canvas-generated options (`image_id`) are wired from the
original prompt stack — never re-uploaded. Only `file_path` / `data_url` /
`asset_id` add new nodes.

Use `@label` in the prompt **only when combining specific parts** across
inputs. Otherwise keep the prompt short and omit `@` mentions — diffui
preserves style from the wired reference automatically.

Examples:

- **Combine options** — `inputs: [{image_id: <opt1>, label: "option-1"}, {image_id: <opt2>, label: "option-2"}]`, prompt "Use the header from @option-1 and the footer from @option-2."
- **Pasted screenshot (hosted MCP, ≤2MB)** — read the saved image file, encode as `data:image/png;base64,...`, then `inputs: [{data_url: "...", label: "screenshot"}]`.
- **Large or many images (hosted MCP)** — `prepare_reference_upload` → run the returned `curl --data-binary @file` via shell (one POST per image, up to 25MB each) → use `asset.id`.
- **Local file (stdio MCP)** — `inputs: [{file_path: "/path/to/logo.png", label: "logo"}]` uploads raw bytes directly (up to 25MB).
- **Uploaded asset** — `inputs: [{asset_id: <id>, label: "screenshot"}]`, prompt "Settings page matching @screenshot's visual style."

Use `upload_reference` first when a file will be reused across several
generations; pass `file_path` or `data_url` directly to those tools for one-offs.

## 3. Chosen option → build out the rest of the site

When the user settles on an option, **do not lock anything** — the chosen
option's imageId (from your ledger) is the only handle you need. Immediately:

1. **Read the header to find the pages.** Look at the chosen design and read
   the navigation links in its header — those *are* the site's page list. A nav
   reading "Menu · Our Story · Visit · Contact" means those are the pages to
   build. Add any obvious page the design implies but the nav omits (a cart /
   checkout behind a cart icon, a sign-up behind a "Get started" button). List
   the pages you inferred and confirm or adjust with the user before generating.
2. **Generate all pages in one parallel call.** Call `generate_pages` with `input_image_id` set to the
   **chosen option's imageId** and a `pages` array — one entry per screen with a short prompt
   (e.g. `{name: "Features", prompt: "Create the features page"}`). Do **not** call `generate_page`
   repeatedly in a loop; that runs sequentially and is much slower.
3. **Track page name → imageId** in your ledger as each page returns. No lock
   step is involved; the imageId is the durable handle for brands and the build.

If the header nav is missing or ambiguous, fall back to domain conventions:

- e-commerce: product listing, product detail, cart, checkout
- SaaS: pricing, features, sign-up, dashboard, settings
- restaurant: menu, reservations, about, contact

## 4. Auto-create a brand (≥5 screens)

Track the screens kept this session. When **five or more visually consistent
screens** exist and the conversation suggests more screens are coming,
proactively offer to create a brand:

> "You now have N screens in a consistent style. Want me to create a brand
> from them? Future screens will then match automatically."

On yes: `create_brand_from_images` with those imageIds and a name derived
from the project. After the brand exists:

- Pass `brand_id` on every `generate_options` / `generate_page` call and
  **stop** manual input rigging — diffui auto-selects the best brand
  references per prompt via embedding matching.
- After each new screen the user keeps that fits the brand, call
  `add_image_to_brand`.

## 5. Brands by name

- If the user names a brand ("use the Acme brand"), call `list_brands`,
  match by name, and pass its id.
- If a new request clearly resembles an existing brand (same product,
  company, or style), proactively suggest using it: check `list_brands`
  early in a session when the user's intent hints at existing work.

## 6. Convert to code

When the user named an output folder up front (e.g. `demoBuild/bongo`), you still
complete the diffui design phase first. Remember that path; use it when writing
files after `create_build_link`.

When the design flow feels complete (pages generated, user satisfied), ask:
**"Ready to convert these designs to code?"** On yes:

1. Call `create_build_link` with every page you kept — the imageIds in your
   ledger — (`image_id`, `name`, `original_prompt`, and `brand_id` if one
   exists). Markdown is returned inline by default.
2. Follow the returned build instructions markdown exactly — it is the
   source of truth for implementation. Keep the `buildId` from the tool
   result for asset tools.
3. For **all** asset needs during the build, use the MCP build tools with
   that `build_id` (the MCP API key is already configured — do **not** use
   temporary `authToken` values):
   - `build_generate_image` for photos/illustrations
   - `build_generate_svg` for icons and vector art
   - `build_remove_background` for cutouts
   - `build_create_texture` for seamless background textures
   - `build_get_image` to download design/generated assets locally
   Never hotlink canvas/preview URLs into the built code; download assets
   locally as the markdown instructs.
4. If you cannot write code in the current environment (e.g. chat-only),
   give the user the `handoff` string from the tool result to paste into
   their coding agent.

## Ground rules

- **Design before code.** If you have not called `generate_options` this session,
  you are not allowed to create webpage files yet.
- All option images are returned inline by the tool — rely on those, not the browser canvas.
- Keep a running ledger of option letters → imageIds → page names in your reasoning only;
  never restate UUIDs to the user.
- Generations normally take **60 seconds to 5 minutes** per batch (4 options or
  a page). A quiet call is working, not stuck — **never re-issue a generation
  to "retry" a slow one.** A duplicate run desyncs the canvas and leaves you
  holding imageIds that aren't in committed state. If you truly need longer,
  raise `timeout_seconds` on a fresh call, don't fire a second one alongside
  the first.
- **If `generate_options` / `generate_pages` itself errors with a timeout**
  (e.g. "MCP error -32001: Request timed out") **do not treat this as
  failure and do not re-issue the generation.** This is a known client-side
  timeout independent of the server — the generation keeps rendering
  regardless of whether the tool call that started it got a response. Call
  `get_canvas_state` on the same `project_id` and poll it every ~10–15
  seconds until every slot reports `status: "ready"` (this can take the same
  60s–5min as a normal call), then use each slot's `imageId` with `get_image`
  to retrieve the finished options. Only report an actual failure to the
  user if `get_canvas_state` still shows slots stuck `loading` well past 5
  minutes, or shows an explicit error status.
- Generation costs the user wallet credits per image. Use the defaults
  (4 options for explorations, 1 for pages); confirm before unusually large
  batches or regenerating many screens at once.
- If a generation fails with a billing error, tell the user their diffui
  wallet needs funds.
- If a tool errors with authentication problems, call `authenticate` once and
  retry — do not open with a proactive whoami check.
