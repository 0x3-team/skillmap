import { handleImportRoute } from "@/lib/import/route.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const { sessionId } = await context.params;
  return handleImportRoute(request, "expire", { sessionId });
}
