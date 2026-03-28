import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readRepoFile = (...parts: string[]) => readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

describe("android network security config", () => {
  it("permits cleartext HTTP for LAN C64U targets", () => {
    const manifest = readRepoFile("android", "app", "src", "main", "AndroidManifest.xml");
    const networkSecurityConfig = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "network_security_config.xml",
    );

    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(manifest).toContain('android:usesCleartextTraffic="true"');
    expect(networkSecurityConfig).toContain('<base-config cleartextTrafficPermitted="true" />');
  });

  it("retains explicit archive host entries", () => {
    const networkSecurityConfig = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "network_security_config.xml",
    );

    expect(networkSecurityConfig).toContain(
      '<domain includeSubdomains="false">commoserve.files.commodore.net</domain>',
    );
    expect(networkSecurityConfig).toContain('<domain includeSubdomains="false">hackerswithstyle.se</domain>');
  });
});
