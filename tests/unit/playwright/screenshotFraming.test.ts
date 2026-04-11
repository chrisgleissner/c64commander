import { describe, expect, it } from "vitest";
import { getScreenshotFraming } from "@/../playwright/screenshotFraming";

describe("getScreenshotFraming", () => {
  it("keeps switch-device screenshots in page context", () => {
    expect(getScreenshotFraming("switch-device-sheet")).toBe("viewport");
  });

  it("keeps docs section screenshots in page context", () => {
    expect(getScreenshotFraming("docs-section")).toBe("viewport");
    expect(getScreenshotFraming("docs-external")).toBe("viewport");
  });
});
