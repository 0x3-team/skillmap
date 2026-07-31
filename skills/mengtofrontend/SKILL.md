---
name: mengtofrontend
description: Audit and refine landing pages to avoid generic AI-generated visual quality problems using Meng To's frontend design checklist. Use when Codex is asked to review, polish, improve, redesign, or prepare a landing page before launch, especially for typography, letter spacing, font choice, image authenticity, AI-generated visuals, prompt quality, micro-interactions, and final human design details.
---

# MengToFrontend

## Overview

Use this skill as a pre-launch quality pass for landing pages. The principle is: AI can generate the first draft, but a professional page needs typography judgment, real references, visual cleanup, and one or two deliberate human touches.

Source inspiration: Meng To's X tutorial, "Design Skills: How to Avoid AI Slop in Landing Pages" (`https://x.com/MengTo/status/2062484065748701429`).

## Workflow

1. Inspect the page as a user would: desktop and mobile first viewport, then the full page.
2. Identify visible "AI slop" signals before editing: generic layout, mismatched images, unnatural text spacing, overused gradients, inconsistent shadows, vague copy, or decorative details without product relevance.
3. Fix the highest-impact issues in this order: typography, real visual references, image quality, layout hierarchy, micro-interactions, final originality.
4. Verify the final result visually with screenshots or browser inspection when a local app or URL is available.
5. Return a concise launch-readiness checklist with remaining risks.

## Typography

- Check `letter-spacing` on headings, labels, buttons, nav items, and all-caps text.
- Avoid negative tracking on normal body text and compact UI labels unless the existing brand system clearly uses it.
- Use tighter tracking only when the font and size support it; inspect at mobile sizes because AI-generated pages often collapse into cramped text there.
- Test at least two plausible font directions when typography feels generic: one neutral/productive option and one brand-specific option.
- Match type scale to context. Avoid hero-sized type inside compact cards, sidebars, dashboards, and small panels.
- Prefer fewer font weights with clear hierarchy over many arbitrary weights.

## Real References

- Ask for or gather real image references when visual authenticity matters: product photos, venue photos, competitor screenshots, brand references, material textures, UI examples, or founder-provided assets.
- Prefer real product/place/person imagery over atmospheric stock-like art.
- If generated images are needed, ground prompts in concrete references and inspect the result for artifacts before shipping.
- Do not let decorative AI visuals replace proof: screenshots, product state, customer workflow, actual object, or real environment should be visible when relevant.

## Image Refinement

- Treat AI images as draft assets. Check hands, faces, logos, text, product geometry, lighting direction, shadow contact, depth, and cropping.
- Add practical refinements where possible: replace fake texture with real texture, correct lighting mismatch, remove artifacts, simplify busy backgrounds, and align image contrast with surrounding UI.
- Make image crops intentional. Avoid dark, blurred, or overly cropped media when users need to inspect the subject.
- Keep visual style consistent across all images. Mixed photo styles, icon styles, and illustration styles create an obvious generated feel.

## Prompt Quality

- Use specific prompts for brand/product names, audience, material, camera angle, lighting, mood, and layout role.
- Include negative constraints for common failure modes: no fake text, no warped logo, no extra fingers, no distorted interface, no illegible labels.
- For landing pages, prompt for the actual business subject instead of abstract "modern SaaS" visuals.
- Keep generated visual prompts tied to page sections: hero proof image, feature detail, testimonial context, or product state.

## Human Touch

- Add one or two custom details that connect to the product, not random decoration.
- Use subtle micro-interactions only where they clarify state or make the interface feel responsive: hover, focus, reveal, active tab, form validation, or a tasteful hero motion.
- Replace generic copy with concrete claims, audience language, and product-specific nouns.
- Ensure icons, dividers, badges, and background treatments serve hierarchy or comprehension.

## Audit Output

When auditing, report findings in this format:

```text
Launch readiness: [Ready / Needs polish / Not ready]

Top fixes:
1. [Issue] - [specific correction]
2. [Issue] - [specific correction]
3. [Issue] - [specific correction]

Checklist:
- Typography and letter spacing: [pass/fail + note]
- Real references and imagery: [pass/fail + note]
- Image refinement: [pass/fail + note]
- Prompt/design specificity: [pass/fail + note]
- Human touch and micro-interactions: [pass/fail + note]
- Mobile visual quality: [pass/fail + note]
```

When implementing fixes, edit the page directly and then provide a short summary plus verification performed.
