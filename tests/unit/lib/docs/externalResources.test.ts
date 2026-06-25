import { describe, expect, it } from "vitest";

import {
  C64U_USER_GUIDE_URL,
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
        label: "Ultimate REST API Documentation",
        href: "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
      }),
    );
  });

  it("replaces Ultimate links with the single C64U user guide for c64u-remote", () => {
    expect(getDocsExternalResourceLinks("c64u-remote")).toEqual([
      {
        id: "c64u-user-guide",
        label: "C64U User Guide",
        href: C64U_USER_GUIDE_URL,
        testId: "docs-external-resource-c64u-user-guide",
      },
    ]);
    expect(getSettingsDocumentationLink("c64u-remote")).toEqual({
      id: "c64u-user-guide",
      label: "C64U User Guide",
      href: C64U_USER_GUIDE_URL,
      testId: "settings-about-c64u-user-guide",
    });
  });
});
