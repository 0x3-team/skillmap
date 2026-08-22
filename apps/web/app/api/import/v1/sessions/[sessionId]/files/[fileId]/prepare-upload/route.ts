import { handleImportRoute } from "@/lib/import/route.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string; fileId: string }> }
): Promise<Response> {
  const { sessionId, fileId } = await context.params;
  return handleImportRoute(request, "prepare-upload", { sessionId, fileId });
}
