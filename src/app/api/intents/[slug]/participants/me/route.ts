import { backendHandlers } from "@/features/backend/runtime";

export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ slug: string }> }) {
  return backendHandlers.updateParticipant(request, (await context.params).slug);
}
