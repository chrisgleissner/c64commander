import { describe, expect, it } from "vitest";
import {
  applySavedDeviceDraftHostInput,
  applySavedDeviceDraftNameInput,
  buildSavedDeviceEditorDraft,
  isLocalOnlySavedDeviceEdit,
} from "@/lib/savedDevices/deviceEditor";

describe("deviceEditor", () => {
  it("builds inferred names from normalized hosts without the http port", () => {
    expect(
      buildSavedDeviceEditorDraft({
        name: "",
        nameSource: "INFERRED",
        host: "u64:8080",
        type: "",
        typeSource: "INFERRED",
        httpPort: 8080,
        ftpPort: 21,
        telnetPort: 64,
      }),
    ).toMatchObject({
      host: "u64:8080",
      name: "u64",
      nameSource: "INFERRED",
    });
  });

  it("recomputes inferred names from the normalized host while editing", () => {
    expect(
      applySavedDeviceDraftHostInput(
        {
          name: "c64u",
          nameSource: "INFERRED",
          host: "c64u",
          type: "",
          typeSource: "INFERRED",
          httpPort: "80",
          ftpPort: "21",
          telnetPort: "64",
        },
        "u64:8080",
      ),
    ).toMatchObject({
      host: "u64:8080",
      name: "u64",
      nameSource: "INFERRED",
      type: "",
      typeSource: "INFERRED",
    });
  });

  it("keeps the draft name empty when the inferred label is cleared", () => {
    expect(
      applySavedDeviceDraftNameInput(
        {
          name: "c64u",
          nameSource: "INFERRED",
          host: "c64u",
          type: "",
          typeSource: "INFERRED",
          httpPort: "80",
          ftpPort: "21",
          telnetPort: "64",
        },
        "   ",
      ),
    ).toMatchObject({
      name: "",
      nameSource: "INFERRED",
      host: "c64u",
    });
  });
});

describe("isLocalOnlySavedDeviceEdit (HARD27-037)", () => {
  const current = { host: "c64u", httpPort: 80 };

  it("treats a rename as a local-only edit", () => {
    expect(isLocalOnlySavedDeviceEdit(current, { host: "c64u", httpPort: 80 }, false, true)).toBe(true);
  });

  it("ignores host case and surrounding whitespace", () => {
    expect(isLocalOnlySavedDeviceEdit(current, { host: " C64U ", httpPort: 80 }, false, true)).toBe(true);
  });

  it("is not local-only when the host changed", () => {
    expect(isLocalOnlySavedDeviceEdit(current, { host: "192.168.1.15", httpPort: 80 }, false, true)).toBe(false);
  });

  it("is not local-only when the HTTP port changed", () => {
    expect(isLocalOnlySavedDeviceEdit(current, { host: "c64u", httpPort: 8080 }, false, true)).toBe(false);
  });

  it("is not local-only when a password is being set", () => {
    expect(isLocalOnlySavedDeviceEdit(current, { host: "c64u", httpPort: 80 }, true, true)).toBe(false);
  });

  it("is not local-only when nothing changed, so Save & Connect still probes", () => {
    expect(isLocalOnlySavedDeviceEdit(current, { host: "c64u", httpPort: 80 }, false, false)).toBe(false);
  });
});
