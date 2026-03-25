import { describe, expect, it } from "vitest";
import { makeBodyPreview } from "./traceSchema.js";

describe("makeBodyPreview", () => {
  it("returns RestResponseEntry-compatible preview field names", () => {
    expect(makeBodyPreview({ ok: true })).toEqual({
      bodyPreviewHex: expect.any(String),
      bodyPreviewAscii: expect.any(String),
    });
  });
});
