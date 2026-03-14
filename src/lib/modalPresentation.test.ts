import { describe, expect, it } from "vitest";

import { resolveModalPresentation } from "@/lib/modalPresentation";

describe("modalPresentation", () => {
  it("promotes selection browsers and list browsers to compact full-screen mode", () => {
    expect(resolveModalPresentation("compact", "selection-browser").mode).toBe("fullscreen");
    expect(resolveModalPresentation("compact", "list-browser").mode).toBe("fullscreen");
  });

  it("keeps confirmation dialogs centered while allowing large browser surfaces on medium and expanded", () => {
    expect(resolveModalPresentation("compact", "confirmation").mode).toBe("centered");
    expect(resolveModalPresentation("medium", "selection-browser").mode).toBe("large");
    expect(resolveModalPresentation("expanded", "list-browser").mode).toBe("large");
  });

  it("uses sticky-footer treatment for full-screen and editor-style surfaces", () => {
    expect(resolveModalPresentation("compact", "secondary-editor").footerClassName).toContain("sticky");
    expect(resolveModalPresentation("medium", "selection-browser").footerClassName).toContain("sticky");
    expect(resolveModalPresentation("medium", "confirmation").footerClassName).toBe("");
  });
});
