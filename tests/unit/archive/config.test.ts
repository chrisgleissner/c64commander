import { describe, expect, it } from "vitest";
import {
  buildDefaultArchiveClientConfig,
  resolveArchiveClientConfig,
  validateArchiveHost,
} from "@/lib/archive/config";

describe("archive config", () => {
  it("uses the default source values when overrides are empty or invalid", () => {
    expect(resolveArchiveClientConfig(buildDefaultArchiveClientConfig({ hostOverride: "http://bad.example" }))).toMatchObject({
      id: "archive-commoserve",
      name: "CommoServe",
      host: "commoserve.files.commodore.net",
      clientId: "Commodore",
      userAgent: "Assembly Query",
      baseUrl: "http://commoserve.files.commodore.net",
    });
  });

  it("prefers explicit source config values for custom sources", () => {
    expect(
      resolveArchiveClientConfig({
        id: "archive-custom",
        name: "Custom Archive",
        baseUrl: "http://archive.local:3002",
        headers: {
          "Client-Id": "Custom",
          "User-Agent": "Custom Agent",
        },
      }),
    ).toMatchObject({
      id: "archive-custom",
      name: "Custom Archive",
      host: "archive.local:3002",
      clientId: "Custom",
      userAgent: "Custom Agent",
      baseUrl: "http://archive.local:3002",
    });
  });

  it("validates hostnames without protocol prefixes", () => {
    expect(validateArchiveHost("http://example.com")).toContain("hostname only");
    expect(validateArchiveHost("example.com/library?q=1")).toContain("without paths or query strings");
    expect(validateArchiveHost("example.com")).toBeNull();
    expect(validateArchiveHost("127.0.0.1:3001")).toBeNull();
  });
});
