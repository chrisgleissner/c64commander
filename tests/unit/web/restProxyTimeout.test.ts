// @vitest-environment node
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_REST_PROXY_TIMEOUT_MS } from "../../../web/server/src/index";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/*
 * HARD27-017 bounds the proxy's upstream request so a wedged device cannot hold server
 * resources. That bound also decides how long the browser may wait, so it has to clear every
 * budget the client itself allows: a proxy deadline below the client's own means the app is
 * told the device timed out while it was still willing to wait.
 *
 * The client's budgets are read out of the source rather than restated here, so adding a
 * longer one fails this test instead of silently shortening it on the web platform.
 */
describe("REST proxy timeout", () => {
  it("exceeds every request budget the client itself allows", async () => {
    const source = await fs.readFile(path.join(REPO_ROOT, "src/lib/c64api.ts"), "utf8");
    const budgets = [...source.matchAll(/^const [A-Z0-9_]*TIMEOUT_MS\s*=\s*([\d_]+);/gm)].map(([, value]) =>
      Number(value.replace(/_/g, "")),
    );

    // An empty match list would satisfy the comparison below without checking anything.
    expect(budgets.length, "no client request budget was found to compare against").toBeGreaterThan(2);
    expect(DEFAULT_REST_PROXY_TIMEOUT_MS).toBeGreaterThan(Math.max(...budgets));
  });
});
