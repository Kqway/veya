import { backendHandlers } from "@/features/backend/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  return backendHandlers.getIntent(request, (await context.params).slug);
}
export async function DELETE(request: Request, context: Context) {
  return backendHandlers.closeIntent(request, (await context.params).slug);
}
