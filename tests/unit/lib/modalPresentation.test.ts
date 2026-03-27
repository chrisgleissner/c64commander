import { describe, expect, it } from "vitest";

import { resolveModalPresentation } from "@/lib/modalPresentation";

describe("modalPresentation", () => {
  it("uses large presentation for browser-style modal surfaces on every profile", () => {
    expect(resolveModalPresentation("compact", "selection-browser").mode).toBe("large");
    expect(resolveModalPresentation("compact", "list-browser").mode).toBe("large");
    expect(resolveModalPresentation("expanded", "selection-browser").mode).toBe("large");
  });

  it("keeps confirmation dialogs centered while allowing large browser surfaces", () => {
    expect(resolveModalPresentation("compact", "confirmation").mode).toBe("centered");
    expect(resolveModalPresentation("medium", "selection-browser").mode).toBe("large");
    expect(resolveModalPresentation("expanded", "list-browser").mode).toBe("large");
  });

  it("uses sticky-footer treatment for browser and editor surfaces", () => {
    expect(resolveModalPresentation("compact", "secondary-editor").footerClassName).toContain("sticky");
    expect(resolveModalPresentation("medium", "selection-browser").footerClassName).toContain("sticky");
    expect(resolveModalPresentation("medium", "confirmation").footerClassName).toBe("");
  });

  it("keeps popovers and command palettes centered", () => {
    expect(resolveModalPresentation("medium", "popover")).toMatchObject({
      mode: "centered",
      footerClassName: "",
    });
    expect(resolveModalPresentation("compact", "secondary-editor")).toMatchObject({
      mode: "centered",
    });
    expect(resolveModalPresentation("compact", "command-palette")).toMatchObject({
      mode: "centered",
    });
    expect(resolveModalPresentation("expanded", "command-palette")).toMatchObject({
      mode: "centered",
    });
    expect(resolveModalPresentation("medium", "default")).toMatchObject({
      mode: "centered",
      footerClassName: "",
    });
  });

  it("uses centered mode for secondary-editor on non-compact profiles", () => {
    expect(resolveModalPresentation("medium", "secondary-editor")).toMatchObject({ mode: "centered" });
    expect(resolveModalPresentation("expanded", "secondary-editor")).toMatchObject({ mode: "centered" });
  });
});
