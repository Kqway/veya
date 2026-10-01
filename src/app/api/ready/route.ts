import { isDatabaseReady } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const ready = await isDatabaseReady();
  return Response.json({ status: ready ? "ready" : "unavailable" }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
