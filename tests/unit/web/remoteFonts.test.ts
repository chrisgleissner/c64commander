// @vitest-environment node
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "../../../web/server/src/securityHeaders";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const REMOTE_FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const collectSourceFiles = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(full);
      return /\.(ts|tsx|css|html)$/.test(entry.name) ? [full] : [];
    }),
  );
  return files.flat();
};

describe("remote font policy", () => {
  // HARD27-033: the app injected a Google Fonts stylesheet that the server's own
  // CSP forbids, so the fonts never loaded and every page load logged a
  // violation. The app must not request a resource its own CSP blocks.
  it("requests no font from a host the served Content-Security-Policy forbids", async () => {
    const headers = new Map<string, string>();
    applySecurityHeaders(
      { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as never,
      { setHeader: (key: string, value: string) => headers.set(key, value) } as never,
      false,
    );
    const csp = headers.get("Content-Security-Policy") ?? "";
    // Without this the assertions below hold for an empty string, so a server that
    // stopped sending a policy at all would pass the test that exists to check it.
    expect(csp, "the server sent no Content-Security-Policy").toContain("font-src");
    for (const host of REMOTE_FONT_HOSTS) {
      expect(csp).not.toContain(host);
    }

    const sources = [...(await collectSourceFiles(path.join(REPO_ROOT, "src"))), path.join(REPO_ROOT, "index.html")];
    // `offenders` is empty both when nothing references a blocked host and when nothing
    // was scanned, so the scan has to report its own size. `src` holds around 850
    // matching files today.
    expect(sources.length, "the source scan found almost nothing to check").toBeGreaterThan(200);
    const offenders: string[] = [];
    for (const file of sources) {
      const contents = await fs.readFile(file, "utf8");
      if (REMOTE_FONT_HOSTS.some((host) => contents.includes(host))) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
