import { backendHandlers } from "@/features/backend/runtime";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  return backendHandlers.joinIntent(request, (await context.params).slug);
}
