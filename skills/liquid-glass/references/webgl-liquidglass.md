# WebGL LiquidGlass

Use this path for highest visual fidelity: hero sections, marketing moments, magnifiers, live video, canvas/QR surfaces, demos, or explicit "most realistic/wow" requests.

## Recommended Library Path

Prefer `@ybouane/liquidglass` when the repo can accept the dependency and its DOM contract. Recheck npm version and audit first.

Core contract from the library:

- `LiquidGlass.init({ root, glassElements, defaults })` is async.
- Glass elements must be direct children of `root`.
- The root itself is not captured; backgrounds must be child elements inside the root.
- A canvas is injected into each glass element.
- Use `data-config` JSON for per-element options.
- Use `data-dynamic` for direct children that change every frame.
- Call `instance.markChanged(element)` for visual changes that do not fire observed DOM mutations.
- Call `instance.destroy()` during cleanup.

## React Integration Pattern

Use a client-only effect and cleanup correctly:

```tsx
function WebGLLiquidGlassHero() {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let instance: { destroy(): void } | null = null;
    let cancelled = false;

    async function start() {
      if (!rootRef.current || !panelRef.current) return;
      if (document.fonts?.ready) await document.fonts.ready;

      panelRef.current.dataset.config = JSON.stringify({
        blurAmount: 0.25,
        refraction: 0.9,
        chromAberration: 0.06,
        cornerRadius: 36,
        zRadius: 32,
        shadowOpacity: 0.25,
      });

      const { LiquidGlass } = await import("@ybouane/liquidglass");
      if (cancelled) return;
      instance = await LiquidGlass.init({
        root: rootRef.current,
        glassElements: [panelRef.current],
      });
    }

    start().catch((error) => {
      console.warn("LiquidGlass init failed; CSS fallback remains active.", error);
    });

    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, []);

  return (
    <section ref={rootRef} className="glass-root">
      <img className="glass-bg" src="/hero.jpg" alt="" crossOrigin="anonymous" />
      <div ref={panelRef} className="glass-panel">Readable content</div>
    </section>
  );
}
```

Adapt import strategy for Next.js/SSR. Do not import the library during server render.

## When To Avoid WebGL

- Dense dashboards or operational tools with many repeated cards.
- Components that appear dozens of times in a list.
- UI where battery, scroll performance, or low-end devices matter more than visual "wow".
- Apps with strict CSP/CORS constraints that make image/font capture brittle.
- Any target where WebGL may be disabled and the fallback would be unacceptable.

## Performance Rules

- Use as few roots as possible; each root opens its own WebGL context.
- Avoid `data-dynamic` unless content changes every frame.
- Prefer `markChanged(element)` for one-shot updates.
- Use CORS-safe images: `crossorigin="anonymous"` and proper server headers.
- Wait for webfonts before init or accept font mismatch in captured rasters.
- Destroy instances on route changes/unmount.
- Measure FPS and console warnings on real devices, not only desktop Chrome.

## Visual Tuning

Useful `data-config` fields:

- `blurAmount`: background blur strength.
- `refraction`: image bending strength.
- `chromAberration`: color fringing at edges.
- `edgeHighlight`: rim glow.
- `specular`: highlight intensity.
- `fresnel`: grazing-angle reflection.
- `distortion`: micro distortion.
- `cornerRadius`: CSS-pixel corner radius.
- `zRadius`: bevel depth.
- `opacity`, `saturation`, `tintStrength`, `brightness`.
- `shadowOpacity`, `shadowSpread`, `shadowOffsetY`.
- `floating`, `button`, `bevelMode`.

Keep values moderate for app UI. Use stronger refraction/chroma only for hero or magnifier effects.
