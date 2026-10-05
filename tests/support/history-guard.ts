import { readFileSync } from "node:fs";

// Exercise the same early bootstrap used by the browser, before mock router
// listeners register. This contains only our checked-in static script.
const bootstrap = readFileSync(`${process.cwd()}/public/history-guard.js`, "utf8");
new Function("window", "Event", bootstrap)(window, window.Event);
