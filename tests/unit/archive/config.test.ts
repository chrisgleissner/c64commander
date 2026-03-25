import { describe, expect, it } from "vitest";
import { resolveArchiveClientConfig, validateArchiveHost } from "@/lib/archive/config";

describe("archive config", () => {
  it("uses backend defaults when overrides are empty or invalid", () => {
    expect(
      resolveArchiveClientConfig({
        backend: "commodore",
        hostOverride: "http://bad.example",
        clientIdOverride: "",
        userAgentOverride: "",
      }),
    ).toMatchObject({
      host: "commoserve.files.commodore.net",
      clientId: "Commodore",
      userAgent: "Assembly Query",
      baseUrl: "http://commoserve.files.commodore.net",
    });
  });

  it("prefers valid user overrides over backend defaults", () => {
    expect(
      resolveArchiveClientConfig({
        backend: "assembly64",
        hostOverride: "archive.local:3002",
        clientIdOverride: "Custom",
        userAgentOverride: "Custom Agent",
      }),
    ).toMatchObject({
      host: "archive.local:3002",
      clientId: "Custom",
      userAgent: "Custom Agent",
      baseUrl: "http://archive.local:3002",
    });
  });

  it("validates hostnames without protocol prefixes", () => {
    expect(validateArchiveHost("http://example.com")).toContain("hostname only");
    expect(validateArchiveHost("example.com")).toBeNull();
    expect(validateArchiveHost("127.0.0.1:3001")).toBeNull();
  });
});
