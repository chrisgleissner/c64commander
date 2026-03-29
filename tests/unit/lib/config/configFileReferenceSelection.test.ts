import { describe, expect, it } from "vitest";

import {
  buildConfigReferenceFromBrowserSelection,
  buildLocalConfigReferenceFromAndroidPicker,
  buildLocalConfigReferenceFromWebFile,
  isConfigFileName,
} from "@/lib/config/configFileReferenceSelection";

describe("configFileReferenceSelection", () => {
  it("builds an ultimate config reference from a browser selection", () => {
    const result = buildConfigReferenceFromBrowserSelection(
      {
        id: "ultimate",
        type: "ultimate",
        name: "C64U",
        rootPath: "/",
        isAvailable: true,
        listEntries: async () => [],
        listFilesRecursive: async () => [],
      },
      {
        type: "file",
        name: "Demo.cfg",
        path: "/Temp/Demo.cfg",
        modifiedAt: "2026-03-29T00:00:00.000Z",
        sizeBytes: 123,
      },
    );

    expect(result).toEqual({
      kind: "ultimate",
      fileName: "Demo.cfg",
      path: "/Temp/Demo.cfg",
      modifiedAt: "2026-03-29T00:00:00.000Z",
      sizeBytes: 123,
    });
  });

  it("builds a local config reference from a browser selection", () => {
    const result = buildConfigReferenceFromBrowserSelection(
      {
        id: "local-source",
        type: "local",
        name: "Local",
        rootPath: "/",
        isAvailable: true,
        listEntries: async () => [],
        listFilesRecursive: async () => [],
      },
      {
        type: "file",
        name: "Song.cfg",
        path: "/Configs/Song.cfg",
        modifiedAt: "2026-03-29T00:00:00.000Z",
        sizeBytes: 88,
      },
    );

    expect(result).toEqual({
      kind: "local",
      fileName: "Song.cfg",
      path: "/Configs/Song.cfg",
      sourceId: "local-source",
      modifiedAt: "2026-03-29T00:00:00.000Z",
      sizeBytes: 88,
    });
  });

  it("builds a persisted local config reference from the Android file picker", () => {
    const result = buildLocalConfigReferenceFromAndroidPicker({
      uri: "content://cfg/demo",
      name: "Demo.cfg",
      permissionPersisted: true,
      modifiedAt: "2026-03-29T00:00:00.000Z",
      sizeBytes: 42,
    });

    expect(result).toEqual({
      kind: "local",
      fileName: "Demo.cfg",
      path: "/Demo.cfg",
      uri: "content://cfg/demo",
      modifiedAt: "2026-03-29T00:00:00.000Z",
      sizeBytes: 42,
    });
  });

  it("builds an in-memory local config reference from a web file", () => {
    const file = new File(["abc"], "WebDemo.cfg", { type: "text/plain", lastModified: Date.UTC(2026, 2, 29) });

    const result = buildLocalConfigReferenceFromWebFile(file);

    expect(result.kind).toBe("local");
    expect(result.fileName).toBe("WebDemo.cfg");
    expect(result.path).toBe("/WebDemo.cfg");
    expect(result.sourceId).toBeTruthy();
    expect(result.sizeBytes).toBe(3);
  });

  it("rejects non-cfg selections", () => {
    expect(isConfigFileName("demo.cfg")).toBe(true);
    expect(isConfigFileName("demo.sid")).toBe(false);
    expect(() =>
      buildLocalConfigReferenceFromAndroidPicker({
        uri: "content://cfg/demo",
        name: "Demo.sid",
        permissionPersisted: true,
      }),
    ).toThrow("Select a .cfg file.");
  });
});
