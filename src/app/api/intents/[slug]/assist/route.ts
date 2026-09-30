import { aiHandlers } from "@/features/backend/runtime";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return aiHandlers.assist(request, (await params).slug);
}
