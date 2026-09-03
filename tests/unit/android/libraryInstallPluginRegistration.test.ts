import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LIBRARY_INSTALL_PLUGIN_NAME } from "@/lib/native/libraryInstall";

const readRepoFile = (...parts: string[]) => readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

const readNativeSource = (fileName: string) =>
  readRepoFile("android", "app", "src", "main", "java", "uk", "gleissner", "c64commander", fileName);

describe("android library install guard registration", () => {
  it("registers the plugin under the name the web layer asks the platform for", () => {
    expect(readNativeSource("MainActivity.kt")).toContain("registerPlugin(LibraryInstallPlugin::class.java)");
    expect(readNativeSource("LibraryInstallPlugin.kt")).toContain(
      `@CapacitorPlugin(name = "${LIBRARY_INSTALL_PLUGIN_NAME}")`,
    );
  });

  it("declares the install guard as its own data-sync service, separate from playback", () => {
    const manifest = readRepoFile("android", "app", "src", "main", "AndroidManifest.xml");

    expect(manifest).toContain(
      '<service android:name=".LibraryInstallService" android:exported="false" android:foregroundServiceType="dataSync" />',
    );
    expect(manifest).toContain('<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />');
  });
});
