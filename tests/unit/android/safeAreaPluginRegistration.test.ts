import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readRepoFile = (...parts: string[]) => readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

describe("android safe-area plugin registration", () => {
  it("registers the SafeArea capacitor plugin in MainActivity", () => {
    const mainActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "uk",
      "gleissner",
      "c64commander",
      "MainActivity.kt",
    );

    expect(mainActivity).toContain("registerPlugin(SafeAreaPlugin::class.java)");
  });

  it("exposes system bar and display cutout insets through the plugin", () => {
    const pluginSource = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "uk",
      "gleissner",
      "c64commander",
      "SafeAreaPlugin.kt",
    );

    expect(pluginSource).toContain('@CapacitorPlugin(name = "SafeArea")');
    expect(pluginSource).toContain("WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()");
    expect(pluginSource).toContain('put("top", insets?.top ?: 0)');
    expect(pluginSource).toContain('put("bottom", insets?.bottom ?: 0)');
  });
});
