import { describe, expect, it } from "vitest";

import {
  buildConfigReferenceFromBrowserSelection,
  buildConfigReferenceFromSourceEntry,
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
      uri: null,
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

  it("rejects browser selection when type is not file", () => {
    expect(() =>
      buildConfigReferenceFromBrowserSelection(
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
          type: "dir",
          name: "Configs",
          path: "/Configs",
        },
      ),
    ).toThrow("Select a .cfg file.");
  });

  it("rejects browser selection for unsupported source type", () => {
    expect(() =>
      buildConfigReferenceFromBrowserSelection(
        {
          id: "hvsc",
          type: "hvsc",
          name: "HVSC",
          rootPath: "/",
          isAvailable: true,
          listEntries: async () => [],
          listFilesRecursive: async () => [],
        },
        {
          type: "file",
          name: "Demo.cfg",
          path: "/Demo.cfg",
        },
      ),
    ).toThrow("Only local or C64U config files can be attached.");
  });

  it("rejects Android picker result when permission not persisted", () => {
    expect(() =>
      buildLocalConfigReferenceFromAndroidPicker({
        uri: "content://cfg/demo",
        name: "Demo.cfg",
        permissionPersisted: false,
      }),
    ).toThrow("Config file access was not granted.");
  });

  it("rejects Android picker result when uri is absent", () => {
    expect(() =>
      buildLocalConfigReferenceFromAndroidPicker({
        uri: null,
        name: "Demo.cfg",
        permissionPersisted: true,
      }),
    ).toThrow("Config file access was not granted.");
  });

  it("builds ultimate config reference with null modifiedAt and sizeBytes when not provided", () => {
    const result = buildLocalConfigReferenceFromAndroidPicker({
      uri: "content://cfg/no-meta",
      name: "Demo.cfg",
      permissionPersisted: true,
    });
    expect(result.modifiedAt).toBeNull();
    expect(result.sizeBytes).toBeNull();
  });

  it("builds source entry reference for ultimate type without localEntries", () => {
    const result = buildConfigReferenceFromSourceEntry({
      sourceType: "ultimate",
      entry: { name: "Demo.cfg", path: "/Configs/Demo.cfg", modifiedAt: null, sizeBytes: null },
    });
    expect(result).toEqual({
      kind: "ultimate",
      fileName: "Demo.cfg",
      path: "/Configs/Demo.cfg",
      modifiedAt: null,
      sizeBytes: null,
    });
  });

  it("builds source entry reference for local type without sourceId", () => {
    const result = buildConfigReferenceFromSourceEntry({
      sourceType: "local",
      sourceId: null,
      entry: { name: "Demo.cfg", path: "/Demo.cfg", modifiedAt: "2026-01-01", sizeBytes: 10 },
    });
    expect(result.kind).toBe("local");
    expect(result.sourceId).toBeNull();
    expect(result.uri).toBeNull();
    expect(result.modifiedAt).toBe("2026-01-01");
  });

  it("enriches local ref with uri and modifiedAt from localEntriesBySourceId when present", () => {
    const localEntriesBySourceId = new Map([
      [
        "src-1",
        new Map([
          [
            "/Demo.cfg",
            { name: "Demo.cfg", uri: "content://files/demo", modifiedAt: "2026-03-01", sizeBytes: 55 },
          ],
        ]),
      ],
    ]);
    const result = buildConfigReferenceFromSourceEntry({
      sourceType: "local",
      sourceId: "src-1",
      entry: { name: "Demo.cfg", path: "/Demo.cfg", modifiedAt: "2026-01-01", sizeBytes: 10 },
      localEntriesBySourceId,
    });
    expect(result.kind).toBe("local");
    expect(result.uri).toBe("content://files/demo");
    expect(result.modifiedAt).toBe("2026-03-01");
    expect(result.sizeBytes).toBe(55);
  });
});
