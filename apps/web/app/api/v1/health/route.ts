import { evaluateHealth } from "@/lib/operations/health";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache"
} as const;

export async function GET() {
  const health = evaluateHealth();
  return Response.json(health, {
    status: health.status === "ready" ? 200 : 503,
    headers: NO_STORE_HEADERS
  });
}
