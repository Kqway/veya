import { backendHandlers } from "@/features/backend/runtime";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return backendHandlers.vote(request, (await params).slug);
}
