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
    // C64U Remote targets a compact keypad phone. The manual describes it generically
    // rather than naming a model, so it survives new supported handsets, and it must
    // never speak of a tablet.
    expect(c64uRemote).toContain("It runs on a compact, keypad-first phone, which this guide simply calls your phone.");
    expect(c64uRemote).not.toMatch(/tablet/i);
    // The broad C64 Commander edition also runs on tablets, so its wider phrasing stays intact.
    expect(c64Commander).toContain("phone or tablet");
    expect(c64uRemote).toContain("profiles/compact/04-app-ready.png");
    expect(c64uRemote).toContain("HVSC preparation");
    // HVSC ships on in the keypad edition too, so the manual states that rather than telling the
    // reader to go and switch on a library the app already has.
    expect(c64uRemote).toContain("On by default. You can turn it off in Settings → Stable Features.");
    expect(c64uRemote).not.toMatch(/lighting/i);

    expect(c64Commander).toContain("# C64 Commander Manual");
    expect(c64Commander).not.toContain("C64U Remote");
    expect(c64Commander).toContain("profiles/medium/04-app-ready.png");
    expect(c64Commander).toContain("HVSC preparation");
    expect(c64Commander).toContain("On by default. You can turn it off in Settings → Stable Features.");
  });

  /**
   * Both manuals describe the phone running the app through the naming helpers, never by
   * model. A model name would date the manual and need revising for each newly supported
   * handset.
   *
   * The guard is a shape rather than a list of names, deliberately: writing the names we
   * do not want into a tracked file would put them back in the tree, which is what naming
   * the device generically was for. A capitalised word followed by a four-digit number is
   * the shape a handset model takes, and neither manual contains one today. Bare
   * four-digit numbers are left alone because the manuals are full of legitimate ones -
   * $0801, the 1541/1571/1581 drives, the 6581/8580 SIDs, 1982.
   */
  it("names no device model in either manual", async () => {
    const contexts = await contextByVariant();
    const modelShape = /\b[A-Z][A-Za-z]+[ -]?[0-9]{4}\b/;

    for (const variantId of ["c64u-remote", "c64commander"]) {
      const manual = renderManualMarkdown(contexts[variantId]);
      expect(manual.match(modelShape)?.[0] ?? null).toBeNull();
    }
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
    expect(c64uRemote).toContain("Files and folders available on your phone.");
    expect(c64uRemote).toContain(
      "| Device Safety | **Settings → Device Safety** | Leave it on Auto. Auto keeps a Commodore 64 Ultimate on Conservative until its firmware is known to be safe. See Device Safety Modes. |",
    );
    expect(c64uRemote).toContain("set **Auto save config** to **Yes**");
    expect(c64uRemote).toContain("at **C= + RESTORE → User interface → Auto save config**");
    expect(c64uRemote).toContain("the same setting appears in Config as **User interface → Auto save config**.");

    expect(c64Commander).toContain(
      "It works with the Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, and Ultimate-II.",
    );
    expect(c64Commander).toContain("Enter a hostname such as `c64u`, `u64`, or `u2`");
    expect(c64Commander).toContain(
      "Leave it on Auto. It starts Conservative while it identifies the device and firmware, then chooses the appropriate profile. See Device Safety Modes.",
    );
    expect(c64Commander).toContain("Files and folders available on the device running the app.");
    expect(c64Commander).not.toContain("running the app running the app");
    expect(c64Commander).toContain(
      "C64 Commander mirrors that menu in Config as **User interface → Auto save config**.",
    );
    expect(c64Commander).toContain(
      "On other supported devices, search Config for **Auto Save Config** if the menu naming differs.",
    );
    expect(c64Commander).toContain("Use **Save to flash** when **Auto save config** is **Ask** or **No**");
  });

  it("documents the In Depth chapter in both variants", async () => {
    const contexts = await contextByVariant();
    const c64uRemote = renderManualMarkdown(contexts["c64u-remote"]);
    const c64Commander = renderManualMarkdown(contexts.c64commander);

    for (const manual of [c64uRemote, c64Commander]) {
      expect(manual).toContain("## In Depth");
      expect(manual).toContain("### RAM Snapshots");
      expect(manual).toContain("### Reading Diagnostics");
      expect(manual).toContain("### Sharing a Diagnostics Report");
      expect(manual).toContain("### Switching Between Devices");
      // The In Depth chapter is listed in the table of contents.
      expect(manual).toContain("- [In Depth](#in-depth)");
      // Sharing-a-report walkthrough and the ZIP privacy note.
      expect(manual).toContain("Share all");
      expect(manual).toContain("Share filtered");
      expect(manual).toContain("Your network password is never in it.");
    }
  });

  it("documents the always-present feature areas and reference appendices in both variants", async () => {
    const contexts = await contextByVariant();
    const c64uRemote = renderManualMarkdown(contexts["c64u-remote"]);
    const c64Commander = renderManualMarkdown(contexts.c64commander);

    for (const manual of [c64uRemote, c64Commander]) {
      // In Depth gained device-feature walkthroughs beyond Remote Input / RAM.
      expect(manual).toContain("### Drives and Disk Images");
      expect(manual).toContain("### The SID Audio Mixer");
      expect(manual).toContain("### Streams");
      expect(manual).toContain("### The Virtual Printer");
      expect(manual).toContain("### File Sources");
      expect(manual).toContain("### Configuration and Saving");

      // Appendices is a top-level chapter; its references are subchapters (H3).
      expect(manual).toContain("## Appendices");
      expect(manual).toContain("- [Appendices](#appendices)");
      expect(manual).toContain("### Feature Reference");
      expect(manual).toContain("### Network Ports and Services");
      expect(manual).toContain("### Device Safety Modes");
      expect(manual).toContain("### Drive Types and Disk Formats");
      expect(manual).toContain("### Snapshot Types and Memory Ranges");
      expect(manual).toContain("### Health Check Probes");
      // Appendix subsections are nested under Appendices in the contents list.
      expect(manual).toContain("  - [Feature Reference](#feature-reference)");
      // Snapshot memory map carries real address ranges.
      expect(manual).toContain("$002B–$0038, $0801–$9FFF");
      // The recommended Device Safety mode is named.
      expect(manual).toContain("| Auto | Chosen for you |");
      // The health check's visible LED heartbeat is documented.
      expect(manual).toContain("pulse once");
    }

    // Balanced firmware guidance is edition-specific: C64U Remote names only the
    // Commodore 64 Ultimate 1.2.0 line; the broad edition also names the 3.15 line.
    expect(c64uRemote).toContain("| Balanced | Up to 2 | A Commodore 64 Ultimate on firmware 1.2.0 or newer. |");
    expect(c64Commander).toContain(
      "| Balanced | Up to 2 | A Commodore 64 Ultimate on firmware 1.2.0 or newer, or an Ultimate 64-family device on 3.15 or newer. |",
    );

    // C64U Remote must not leak broad-edition machines into the new content.
    expect(c64uRemote).not.toContain("Ultimate 64");
    expect(c64uRemote).not.toContain("Ultimate-II");
    expect(c64uRemote).not.toContain("Ultimate-family");
    expect(c64uRemote).not.toContain("3.15");
    expect(c64uRemote).not.toContain("3.14e");
  });

  it("documents Remote Input and its firmware in both variants, with edition-correct machines", async () => {
    const contexts = await contextByVariant();
    const c64uRemote = renderManualMarkdown(contexts["c64u-remote"]);
    const c64Commander = renderManualMarkdown(contexts.c64commander);

    // Both editions enable Remote Input: full section, machine:input endpoint,
    // and the Commodore 64 Ultimate firmware requirement (1.2.0).
    for (const manual of [c64uRemote, c64Commander]) {
      expect(manual).toContain("### Remote Input");
      expect(manual).toContain("`machine:input`");
      expect(manual).toContain("a Commodore 64 Ultimate");
      expect(manual).toContain("1.2.0");
      expect(manual).toContain("KERNAL keyboard buffer");
    }

    // C64 Commander is the broad edition: it also names the Ultimate 64 family
    // (firmware 3.15) and explains the Ultimate-II CIA 1 hardware limit.
    expect(c64Commander).toContain(
      "or an Ultimate 64, Ultimate 64 Elite, or Ultimate 64 Elite II on firmware **3.15** or newer",
    );
    expect(c64Commander).toContain("it cannot change the state of the C64's CIA 1 input chip");

    // C64U Remote is Commodore 64 Ultimate-only: no Ultimate 64 / 3.15 mentions
    // may leak into it, even in the new Remote Input content.
    expect(c64uRemote).not.toContain("Ultimate 64");
    expect(c64uRemote).not.toContain("3.15");
  });

  it("inlines relative screenshot references before PDF rendering", async () => {
    const manualDir = path.resolve("docs/manual/c64u-remote");
    const html = '<img alt="Home" src="../../img/app/home/profiles/compact/01-overview.png">';

    await expect(inlineImageSources(html, manualDir)).resolves.toMatch(/^<img alt="Home" src="data:image\/png;base64,/);
  });
});
