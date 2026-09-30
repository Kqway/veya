import { backendHandlers } from "@/features/backend/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return backendHandlers.getResults(request, (await params).slug);
}
