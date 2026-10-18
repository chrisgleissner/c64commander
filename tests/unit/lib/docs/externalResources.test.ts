import { describe, expect, it } from "vitest";

import {
  externalLinksOpen,
  getDocsExternalResourceLinks,
  getSettingsDocumentationLink,
} from "@/lib/docs/externalResources";

describe("external resource links", () => {
  it("keeps the default Commander upstream resource links", () => {
    expect(getDocsExternalResourceLinks("c64commander")).toEqual([
      expect.objectContaining({
        label: "Ultimate Documentation",
        href: "https://1541u-documentation.readthedocs.io/",
      }),
      expect.objectContaining({
        label: "REST API Reference",
        href: "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
      }),
      expect.objectContaining({
        label: "Ultimate 64 Official Site",
        href: "https://ultimate64.com/",
      }),
    ]);
    expect(getSettingsDocumentationLink("c64commander")).toEqual(
      expect.objectContaining({
        label: "Ultimate REST API documentation",
        href: "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
      }),
    );
  });

  it("offers no external links on c64u-remote, whose phone cannot open them", () => {
    expect(externalLinksOpen("c64u-remote")).toBe(false);
    expect(externalLinksOpen("c64commander")).toBe(true);
    expect(getDocsExternalResourceLinks("c64u-remote")).toEqual([]);
    expect(getSettingsDocumentationLink("c64u-remote")).toBeNull();
  });
});
