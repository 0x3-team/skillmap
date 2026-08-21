import { handleImportRoute } from "@/lib/import/route.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleImportRoute(request, "prepare-target");
}
