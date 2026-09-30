import { aiHandlers } from "@/features/backend/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return aiHandlers.parseIntent(request);
}
