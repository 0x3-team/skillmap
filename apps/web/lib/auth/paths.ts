export function safeNextPath(value: string | null | undefined, fallback = "/account"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const origin = "https://skillmap.invalid";
    const url = new URL(value, origin);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.origin !== origin
      || !url.pathname.startsWith("/")
      || url.pathname.startsWith("//")
      || decodedPath.startsWith("//")
      || decodedPath.includes("\\")
      || /[\u0000-\u001f\u007f]/.test(decodedPath)
    ) return fallback;
    const result = `${url.pathname}${url.search}${url.hash}`;
    return new URL(result, origin).origin === origin ? result : fallback;
  } catch {
    return fallback;
  }
}
