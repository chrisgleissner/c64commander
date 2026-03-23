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

  it("returns false for empty OCR text or empty expected titles", () => {
    expect(ocrContainsExpectedTitle("", "Home")).toBe(false);
    expect(ocrContainsExpectedTitle("HOME C64U HEALTHY", "")).toBe(false);
  });

  it("matches noisy OCR output for multi-word titles", () => {
    const sample = "PLAY FILES C64U e HEALTHY\nConnected";

    expect(ocrContainsExpectedTitle(sample, "Play Files")).toBe(true);
    expect(scoreHeaderOcrCandidate(sample, "Play Files")).toBeGreaterThanOrEqual(7);
  });

  it("accepts minor OCR substitutions in title tokens", () => {
    expect(ocrContainsExpectedTitle("MOME C64U HEALTHY", "Home")).toBe(true);
    expect(ocrContainsExpectedTitle("PLAY FIIES C64U HEALTHY", "Play Files")).toBe(true);
  });

  it("rejects candidates that miss title tokens", () => {
    const sample = "PLAY C64U HEALTHY";

    expect(ocrContainsExpectedTitle(sample, "Play Files")).toBe(false);
  });

  it("detects the short C64 system label and degraded health state", () => {
    expect(ocrContainsSystemLabel("C64 DEGRADED")).toBe(true);
    expect(ocrContainsHeaderHealthState("C64 DEGRADED")).toBe(true);
  });

  it("scores blank OCR text as zero", () => {
    expect(scoreHeaderOcrCandidate("", "Home")).toBe(0);
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

  it("breaks equal OCR scores by preferring the longer normalized candidate", () => {
    const best = pickBestHeaderOcrCandidate(
      [
        { label: "short", text: "HOME C64U" },
        { label: "long", text: "HOME C64U STATUS OK" },
      ],
      "Home",
    );

    expect(best.label).toBe("long");
  });

  it("throws when no OCR candidates are available", () => {
    expect(() => pickBestHeaderOcrCandidate([], "Home")).toThrow(/No OCR candidates were produced/);
  });

  it("prefers the configured tesseract path when provided", () => {
    expect(resolveTesseractCommand("/custom/tesseract", () => false)).toBe("/custom/tesseract");
  });

  it("falls back to a known absolute tesseract path when present", () => {
    expect(resolveTesseractCommand(undefined, (candidate) => candidate === "/usr/bin/tesseract")).toBe(
      "/usr/bin/tesseract",
    );
  });

  it("ignores a blank configured tesseract path and checks the secondary absolute path", () => {
    expect(resolveTesseractCommand("   ", (candidate) => candidate === "/usr/local/bin/tesseract")).toBe(
      "/usr/local/bin/tesseract",
    );
  });

  it("falls back to the bare tesseract command when no absolute path exists", () => {
    expect(resolveTesseractCommand(undefined, () => false)).toBe("tesseract");
  });
});
