import { describe, expect, it } from "vitest";

import { DISPLAY_PROFILE_SEQUENCE } from "@/lib/displayProfiles";
import {
  APP_DIALOG_CONTENT_CLASS,
  APP_SHEET_CONTENT_CLASS,
  MODAL_SURFACES,
  resolveModalPresentation,
} from "@/lib/modalPresentation";

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

  // A horizontal centering transform survives the `enter`/`exit` keyframes of
  // tailwindcss-animate only when the class list also declares the matching enter and
  // exit translate, because those keyframes assign the whole `transform` property. The
  // behavioural proof is `playwright/modalCenteringDuringAnimation.spec.ts`; this
  // assertion catches the class list drifting apart without waiting for a browser.
  const HORIZONTAL_CENTERING = /(^|[\s:])-?translate-x-(\[-50%\]|1\/2)/;
  const requiresMatchingAnimationTranslate = (className: string, label: string) => {
    const centering = className.match(new RegExp(HORIZONTAL_CENTERING, "g")) ?? [];
    if (centering.length === 0) return;

    // A `sm:`-only centering transform needs a `sm:`-scoped enter/exit translate.
    const prefix = centering.every((match) => className.includes(`sm:${match.trim()}`)) ? "sm:" : "";
    expect(className, `${label} centres with a transform but never animates it in from the centre`).toContain(
      `${prefix}data-[state=open]:slide-in-from-left-1/2`,
    );
    expect(className, `${label} centres with a transform but never animates it out from the centre`).toContain(
      `${prefix}data-[state=closed]:slide-out-to-left-1/2`,
    );
  };

  it("animates every transform-centred overlay from its centred position", () => {
    for (const profile of DISPLAY_PROFILE_SEQUENCE) {
      for (const surface of MODAL_SURFACES) {
        requiresMatchingAnimationTranslate(
          resolveModalPresentation(profile, surface).contentClassName,
          `${surface} on the ${profile} profile`,
        );
      }
    }
    requiresMatchingAnimationTranslate(APP_DIALOG_CONTENT_CLASS, "AppDialogContent");
    requiresMatchingAnimationTranslate(APP_SHEET_CONTENT_CLASS, "AppSheetContent");
  });

  it("suppresses browser default focus outlines on centered dialog surfaces", () => {
    expect(resolveModalPresentation("medium", "default").contentClassName).toContain("outline-none");
    expect(resolveModalPresentation("medium", "confirmation").contentClassName).toContain("outline-none");
    expect(resolveModalPresentation("medium", "popover").contentClassName).toContain("outline-none");
  });
});
