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
    expect(c64uRemote).not.toContain("# C64 Commander Manual");
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

  it("documents each variant's supported machines and safety profile guidance", async () => {
    const contexts = await contextByVariant();
    const c64uRemote = renderManualMarkdown(contexts["c64u-remote"]);
    const c64Commander = renderManualMarkdown(contexts.c64commander);

    expect(c64uRemote).toContain("made for controlling a Commodore 64 Ultimate");
    expect(c64uRemote).toContain("scans the local network for a Commodore 64 Ultimate");
    expect(c64uRemote).not.toContain("Ultimate 64");
    expect(c64uRemote).not.toContain("Ultimate-II");
    expect(c64uRemote).not.toContain("Ultimate-family");
    expect(c64uRemote).not.toContain("Commodore 64 Ultimate only");
    expect(c64uRemote).not.toContain("use C64 Commander instead");
    expect(c64uRemote).not.toContain("Enter a hostname such as `c64u`, `u64`, or `u2`");
    expect(c64uRemote).toContain("entries such as `c64u` and `192.168.1.64`");
    expect(c64uRemote).not.toContain("entries such as `c64u`, `u64`");
    expect(c64uRemote).toContain(
      "| Device Safety | **Settings > Device Safety** | Use Conservative as the normal starting point for C64U Remote. |",
    );
    expect(c64uRemote).toContain("set **Auto save config** to **Yes**");
    expect(c64uRemote).toContain("at **C= + RESTORE > User interface > Auto save config**");
    expect(c64uRemote).toContain("the same setting appears in Config as **User interface > Auto save config**.");

    expect(c64Commander).toContain(
      "It works with the Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, and Ultimate-II+(L).",
    );
    expect(c64Commander).toContain("Enter a hostname such as `c64u`, `u64`, or `u2`");
    expect(c64Commander).toContain(
      "Use Balanced for Ultimate 64-family devices when they run firmware newer than 3.15",
    );
    expect(c64Commander).toContain("Otherwise use Conservative.");
    expect(c64Commander).toContain(
      "C64 Commander mirrors that menu in Config as **User interface > Auto save config**.",
    );
    expect(c64Commander).toContain(
      "On other supported devices, search Config for **Auto Save Config** if the menu naming differs.",
    );
    expect(c64Commander).toContain("Use **Save to flash** when **Auto save config** is **Ask** or **No**");
  });

  it("inlines relative screenshot references before PDF rendering", async () => {
    const manualDir = path.resolve("docs/manual/c64u-remote");
    const html = '<img alt="Home" src="../../img/app/home/profiles/compact/01-overview.png">';

    await expect(inlineImageSources(html, manualDir)).resolves.toMatch(/^<img alt="Home" src="data:image\/png;base64,/);
  });
});
