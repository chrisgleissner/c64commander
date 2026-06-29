import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildManualContexts, inlineImageSources, renderManualMarkdown } from "../../../scripts/build-manuals.mjs";

const contextByVariant = async () => {
  const contexts = await buildManualContexts();
  return Object.fromEntries(contexts.map((context) => [context.variant.id, context]));
};

describe("manual generator", () => {
  it("renders variant-specific names, screenshot profiles, and feature references", async () => {
    const contexts = await contextByVariant();
    const c64uRemote = renderManualMarkdown(contexts["c64u-remote"]);
    const c64Commander = renderManualMarkdown(contexts.c64commander);

    expect(c64uRemote).toContain("# C64U Remote Manual");
    expect(c64uRemote).not.toContain("C64 Commander");
    expect(c64uRemote).not.toContain("Callback 8020");
    expect(c64uRemote).toContain("profiles/compact/04-app-ready.png");
    expect(c64uRemote).toContain("HVSC preparation");
    expect(c64uRemote).toContain("Optional. Enable it in Settings > Stable Features.");
    expect(c64uRemote).not.toMatch(/lighting/i);

    expect(c64Commander).toContain("# C64 Commander Manual");
    expect(c64Commander).not.toContain("C64U Remote");
    expect(c64Commander).toContain("profiles/medium/04-app-ready.png");
    expect(c64Commander).toContain("HVSC preparation");
    expect(c64Commander).toContain("On by default. You can change it in Settings > Stable Features.");
  });

  it("inlines relative screenshot references before PDF rendering", async () => {
    const manualDir = path.resolve("docs/manual/c64u-remote");
    const html = '<img alt="Home" src="../../img/app/home/profiles/compact/01-overview.png">';

    await expect(inlineImageSources(html, manualDir)).resolves.toMatch(/^<img alt="Home" src="data:image\/png;base64,/);
  });
});
