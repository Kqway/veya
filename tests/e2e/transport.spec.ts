import { createServer } from "node:http";
import { expect, test } from "../support/browser-test";
import { fetchAuditedResponse } from "../support/audited-response";

test("response auditing recovers a reset GET without replaying a mutation", async ({ page }) => {
  const attempts = { GET: 0, POST: 0 };
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Transport regression</title>");
      return;
    }
    if (request.url !== "/resource" || (request.method !== "GET" && request.method !== "POST")) {
      response.writeHead(404).end();
      return;
    }
    const method = request.method as keyof typeof attempts;
    attempts[method]++;
    if (attempts[method] === 1) {
      request.socket.destroy();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.route(`${origin}/resource`, async (route) => {
      try {
        const response = await fetchAuditedResponse(route);
        await route.fulfill({ response });
      } catch {
        await route.abort();
      }
    });
    await page.goto(origin);
    const read = await page.evaluate(async () => {
      try { return await (await fetch("/resource")).json(); }
      catch { return { failed: true }; }
    });
    expect(read).toEqual({ ok: true });
    expect(attempts.GET).toBe(2);
    const writeFailed = await page.evaluate(async () => {
      try { await fetch("/resource", { method: "POST" }); return false; }
      catch { return true; }
    });
    expect(writeFailed).toBe(true);
    expect(attempts.POST).toBe(1);
  } finally {
    await page.unroute(`${origin}/resource`);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
