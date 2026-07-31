# SVG Displacement

Use this for production DOM liquid glass: nav, cards, menus, toolbars, sheets, buttons, and app UI. This is the default implementation path.

## Architecture

Build the component as layered DOM:

1. Root glass container with stable dimensions and border radius.
2. Visual/refraction layer that receives `filter: url(#glass-filter-id)`.
3. Foreground content layer for readable labels, icons, controls, and focus rings.
4. Inline hidden SVG `<defs>` containing the filter and `feImage` displacement map.
5. CSS fallback classes for unsupported or disabled enhancement.

Do not use SVG filters inside `backdrop-filter` as the main path. Apply SVG filters through the CSS `filter` property, or directly in SVG contexts.

## Filter Shape

A practical production filter can contain:

```xml
<filter id="..." x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
  <feImage href="data:image/png;base64,..." result="map" />
  <feDisplacementMap in="SourceGraphic" in2="map" scale="..." xChannelSelector="R" yChannelSelector="G" result="displaced" />
  <feGaussianBlur in="displaced" stdDeviation="..." result="softened" />
  <feColorMatrix in="softened" type="matrix" values="..." result="..." />
  <feComposite in="..." in2="SourceGraphic" operator="over" />
</filter>
```

Use separate displacement/color passes only when needed. For ordinary UI, one displacement pass plus rim/highlight styling is often enough.

## Displacement Map Generation

Generate a map from component geometry:

- Inputs: width, height, radius, bevel/depth, edge strength, DPR, optional mode (`panel`, `pill`, `dome`, `magnifier`).
- Output: data URL for `feImage`.
- Red channel controls X displacement; green channel controls Y displacement.
- Encode strongest displacement near curved edges and corners, weaker displacement in the center.
- Cache by geometry key: `w:h:r:depth:dpr:mode`.
- Recompute on mount, resize, DPR change, or prop changes only.

Optimization from the Aave-style model: compute one quadrant of a symmetric rounded rectangle map, mirror it into the other quadrants, then compose the final map. This reduces CPU cost for large panels.

## React Implementation Notes

Use `useId()` for filter IDs, but avoid IDs that contain raw `:` when used in CSS URLs. Use `ResizeObserver` and schedule updates through `requestAnimationFrame`.

Skeleton:

```tsx
function LiquidGlassPanel({ children, radius = 28, depth = 0.7, className }) {
  const rawId = useId().replace(/:/g, "-");
  const filterId = `lg-${rawId}`;
  const ref = useRef<HTMLDivElement>(null);
  const [mapHref, setMapHref] = useState<string | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        setMapHref(generateGlassMap(rect.width, rect.height, radius, depth, window.devicePixelRatio || 1));
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [radius, depth]);

  return (
    <div ref={ref} className={className}>
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <filter id={filterId} colorInterpolationFilters="sRGB">
          {mapHref && <feImage href={mapHref} result="map" />}
          <feDisplacementMap in="SourceGraphic" in2="map" scale="18" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="glass-visual" style={{ filter: mapHref ? `url(#${filterId})` : undefined }} />
      <div className="glass-content">{children}</div>
    </div>
  );
}
```

Adapt syntax to the repo's framework and styling conventions. Do not copy this skeleton blindly into SSR code without guarding browser-only APIs.

## Safari And Firefox Guardrails

- Keep a CSS fallback visible before enhancement.
- Bound filter regions; avoid full-screen filter boxes for small components.
- If Safari shows stale maps after geometry changes, remount the SVG filter by changing a `key` or regenerating a fresh filter ID for substantial changes.
- Prefer static maps during animation. Move the element or filtered layer; do not regenerate the map every pointer frame.
- Reduce displacement strength on mobile Safari if edges shimmer or smear.
- Avoid filtering critical text directly. Keep readable text in an unfiltered foreground layer.

## Visual Quality Rules

- Add rim lighting with CSS pseudo-elements or a second SVG pass rather than cranking displacement too high.
- Use subtle chromatic aberration at edges only; overuse reads as broken rendering.
- Pair refraction with shadow/contact shadow and a clear edge highlight so the glass feels raised.
- Tune for the background actually present. Sparse flat backgrounds make refraction look fake; patterned, image, or gradient backgrounds make it visible.
