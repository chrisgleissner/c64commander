import { describe, expect, it } from "vitest";

import {
  normalizeHeaderOcrText,
  ocrContainsExpectedTitle,
  ocrContainsHeaderHealthState,
  ocrContainsSystemLabel,
  pickBestHeaderOcrCandidate,
  resolveTesseractCommand,
  scoreHeaderOcrCandidate,
} from "../../../src/lib/pageHeaderOcr";

describe("pageHeaderOcr", () => {
  it("matches noisy OCR output for single-word titles", () => {
    const sample = "(mai HOME C64U @ HEALTHY\nC64 Commander";

    expect(normalizeHeaderOcrText(sample)).toContain("home c64u healthy");
    expect(ocrContainsExpectedTitle(sample, "Home")).toBe(true);
    expect(ocrContainsSystemLabel(sample)).toBe(true);
    expect(ocrContainsHeaderHealthState(sample)).toBe(true);
  });

  it("matches noisy OCR output for multi-word titles", () => {
    const sample = "PLAY FILES C64U e HEALTHY\nConnected";

    expect(ocrContainsExpectedTitle(sample, "Play Files")).toBe(true);
    expect(scoreHeaderOcrCandidate(sample, "Play Files")).toBeGreaterThanOrEqual(7);
  });

  it("rejects candidates that miss title tokens", () => {
    const sample = "PLAY C64U HEALTHY";

    expect(ocrContainsExpectedTitle(sample, "Play Files")).toBe(false);
  });

  it("prefers the strongest OCR candidate for the expected title", () => {
    const best = pickBestHeaderOcrCandidate(
      [
        { label: "blank", text: "" },
        { label: "weak", text: "PLAY C64U" },
        { label: "strong", text: "PLAY FILES C64U HEALTHY" },
      ],
      "Play Files",
    );

    expect(best.label).toBe("strong");
  });

  it("prefers the configured tesseract path when provided", () => {
    expect(resolveTesseractCommand("/custom/tesseract", () => false)).toBe("/custom/tesseract");
  });

  it("falls back to a known absolute tesseract path when present", () => {
    expect(resolveTesseractCommand(undefined, (candidate) => candidate === "/usr/bin/tesseract")).toBe(
      "/usr/bin/tesseract",
    );
  });

  it("falls back to the bare tesseract command when no absolute path exists", () => {
    expect(resolveTesseractCommand(undefined, () => false)).toBe("tesseract");
  });
});
