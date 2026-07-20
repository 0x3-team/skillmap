export function HostedSkipLink() {
  return (
    <a
      href="#main-content"
      className="fixed left-4 top-3 z-[100] -translate-y-24 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-lift transition-transform focus:translate-y-0 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ring motion-reduce:transition-none"
    >
      Skip to main content
    </a>
  );
}
