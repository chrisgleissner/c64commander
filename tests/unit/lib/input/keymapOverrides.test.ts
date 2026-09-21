/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { addLogMock } = vi.hoisted(() => ({ addLogMock: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addLog: addLogMock }));

import { findBinding } from "@/lib/input/keyEvent";
import {
  getKeymapOverridesVersion,
  installKeymapOverrides,
  matchesDevice,
  subscribeKeymapOverrides,
  type KeymapOverrideFile,
} from "@/lib/input/keymapOverrides";
import { parseKeymapOverride } from "@/lib/input/keymapOverrideSchema";
import {
  getKeymapOverrideReport,
  loadKeymapOverrides,
  subscribeKeymapOverrideReport,
  type KeymapOverrideSource,
} from "@/lib/input/keymapOverrideFiles";
import { resolveInputProfile } from "@/lib/input/profiles";

const press = (init: { key?: string; code?: string; keyCode?: number }) => ({
  key: init.key ?? "",
  code: init.code ?? "",
  keyCode: init.keyCode ?? 0,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
});

const file = (body: Record<string, unknown>) => JSON.stringify({ schema: 1, bindings: [], ...body });

const parsed = (body: Record<string, unknown>): KeymapOverrideFile => {
  const result = parseKeymapOverride(file(body));
  if (!result.ok) throw new Error(result.reason);
  return result.file;
};

const ACME_K100 = { manufacturer: "Acme", model: "K100" };

const sourceOf = (files: Record<string, string>, identity = ACME_K100): KeymapOverrideSource => ({
  identity: async () => identity,
  list: async () => Object.keys(files),
  read: async (name) => files[name],
});

afterEach(() => {
  installKeymapOverrides([]);
  addLogMock.mockClear();
});

describe("keymap override file schema", () => {
  it("accepts a device-specific file and defaults it onto the keypad profile", () => {
    const result = parseKeymapOverride(
      file({
        match: ACME_K100,
        bindings: [{ keyCode: 142, action: "openSearch" }],
        timing: { multiTapTimeoutMs: 900 },
      }),
    );
    expect(result).toEqual({
      ok: true,
      file: {
        schema: 1,
        match: ACME_K100,
        extends: "keypad",
        bindings: [{ keyCode: 142, action: "openSearch" }],
        timing: { multiTapTimeoutMs: 900 },
      },
    });
  });

  it.each([
    ["not JSON", "{", /^not valid JSON/],
    ["an unknown schema version", JSON.stringify({ schema: 2, bindings: [] }), /^schema:/],
    ["an unknown action", file({ bindings: [{ key: "F9", action: "launchMissiles" }] }), /^bindings\.0\.action:/],
    ["a binding that matches nothing", file({ bindings: [{ action: "back" }] }), /needs a code, key or keyCode/],
    ["keyCode 0, which would steal the Back button", file({ bindings: [{ keyCode: 0, action: "back" }] }), /keyCode/],
    ["an unknown field", file({ bindings: [], colour: "red" }), /Unrecognized key/],
    ["an unknown profile", file({ extends: "gamepad" }), /^extends:/],
  ])("rejects %s with a reason", (_label, text, reason) => {
    const result = parseKeymapOverride(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });
});

describe("device matching", () => {
  it("applies a file without match to every handset, even one that reported nothing", () => {
    expect(matchesDevice(parsed({}), null)).toBe(true);
  });

  it("compares manufacturer and model case-insensitively and ignores fields the file leaves out", () => {
    expect(matchesDevice(parsed({ match: { manufacturer: " acme ", model: "K100" } }), ACME_K100)).toBe(true);
    expect(matchesDevice(parsed({ match: { model: "K100" } }), ACME_K100)).toBe(true);
    expect(matchesDevice(parsed({ match: { model: "Pixel 4" } }), ACME_K100)).toBe(false);
    expect(matchesDevice(parsed({ match: { model: "K100" } }), null)).toBe(false);
  });
});

describe("installed overrides", () => {
  it("shadow the built-in keypad binding for the same key and leave other profiles alone", () => {
    expect(findBinding(resolveInputProfile("keypad"), press({ key: "F1" }))?.action).toBe("function1");

    installKeymapOverrides([parsed({ bindings: [{ key: "F1", action: "openSearch" }] })]);

    expect(findBinding(resolveInputProfile("keypad"), press({ key: "F1" }))?.action).toBe("openSearch");
    expect(findBinding(resolveInputProfile("keypad"), press({ keyCode: 19 }))?.action).toBe("dpadUp");
    expect(findBinding(resolveInputProfile("defaultKeyboard"), press({ key: "F1", code: "F1" }))?.action).toBe(
      "softLeft",
    );
  });

  it("let a later file shadow an earlier one and override the multi-tap window", () => {
    installKeymapOverrides([
      parsed({ bindings: [{ keyCode: 142, action: "openSearch" }] }),
      parsed({ bindings: [{ keyCode: 142, action: "openMenu" }], timing: { multiTapTimeoutMs: 1200 } }),
    ]);

    const keymap = resolveInputProfile("keypad");
    expect(findBinding(keymap, press({ keyCode: 142 }))?.action).toBe("openMenu");
    expect(keymap.timing.multiTapTimeoutMs).toBe(1200);
  });

  it("bump the version and notify subscribers, so a keymap resolved before install is replaced", () => {
    const listener = vi.fn();
    const stop = subscribeKeymapOverrides(listener);
    const before = getKeymapOverridesVersion();
    const resolvedBefore = resolveInputProfile("keypad");

    installKeymapOverrides([parsed({ bindings: [{ keyCode: 142, action: "openSearch" }] })]);
    const resolvedAfter = resolveInputProfile("keypad");
    stop();
    installKeymapOverrides([]);

    expect(listener).toHaveBeenCalledOnce();
    expect(getKeymapOverridesVersion()).toBe(before + 2);
    expect(resolvedAfter).not.toBe(resolvedBefore);
    expect(findBinding(resolvedAfter, press({ keyCode: 142 }))?.action).toBe("openSearch");
    expect(resolveInputProfile("keypad")).toBe(resolveInputProfile("keypad"));
  });
});

describe("loading override files", () => {
  it("applies generic files before device files, each in name order, and reports what it did", async () => {
    const listener = vi.fn();
    const stop = subscribeKeymapOverrideReport(listener);

    const report = await loadKeymapOverrides(
      sourceOf({
        "z-acme.json": file({ match: ACME_K100, bindings: [{ keyCode: 142, action: "openMenu" }] }),
        "b-generic.json": file({ bindings: [{ keyCode: 142, action: "star" }] }),
        "a-generic.json": file({ bindings: [{ keyCode: 142, action: "hash" }] }),
        "pixel.json": file({ match: { model: "Pixel 4" }, bindings: [{ keyCode: 142, action: "back" }] }),
        "broken.json": "{",
        "notes.txt": "ignored",
      }),
    );
    stop();

    expect(report.identity).toEqual(ACME_K100);
    expect(report.applied).toEqual(["a-generic.json", "b-generic.json", "z-acme.json"]);
    expect(report.skipped).toEqual([
      { file: "broken.json", reason: expect.stringMatching(/^not valid JSON/) },
      { file: "pixel.json", reason: "for another device" },
    ]);
    expect(report.unavailable).toBeNull();
    expect(findBinding(resolveInputProfile("keypad"), press({ keyCode: 142 }))?.action).toBe("openMenu");
    expect(getKeymapOverrideReport()).toBe(report);
    expect(listener).toHaveBeenCalledOnce();
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Skipped a keymap override file",
      expect.objectContaining({ file: "broken.json" }),
    );
    expect(addLogMock).not.toHaveBeenCalledWith(
      "warn",
      "Skipped a keymap override file",
      expect.objectContaining({ file: "pixel.json" }),
    );
  });

  it("replaces previously installed files, so a deleted file stops applying on reload", async () => {
    await loadKeymapOverrides(sourceOf({ "a.json": file({ bindings: [{ key: "F1", action: "openSearch" }] }) }));
    await loadKeymapOverrides(sourceOf({}));

    expect(findBinding(resolveInputProfile("keypad"), press({ key: "F1" }))?.action).toBe("function1");
  });

  it("skips a file it cannot read and still applies the rest", async () => {
    const source = sourceOf({ "a.json": file({ bindings: [{ key: "F1", action: "openSearch" }] }), "b.json": "" });
    const report = await loadKeymapOverrides({
      ...source,
      read: async (name) => {
        if (name === "b.json") throw new Error("permission denied");
        return source.read(name);
      },
    });

    expect(report.applied).toEqual(["a.json"]);
    expect(report.skipped).toEqual([{ file: "b.json", reason: "could not be read: permission denied" }]);
  });

  it("applies only generic files when the handset cannot say what it is, and logs why", async () => {
    const report = await loadKeymapOverrides({
      ...sourceOf({
        "generic.json": file({ bindings: [{ key: "F1", action: "openSearch" }] }),
        "acme.json": file({ match: ACME_K100, bindings: [] }),
      }),
      identity: async () => {
        throw new Error("plugin missing");
      },
    });

    expect(report.identity).toBeNull();
    expect(report.applied).toEqual(["generic.json"]);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Could not read the device identity for keymap overrides",
      expect.objectContaining({ error: "plugin missing" }),
    );
  });

  it("reports the directory as unavailable when it cannot be listed, and keeps the built-in keymap", async () => {
    installKeymapOverrides([parsed({ bindings: [{ key: "F1", action: "openSearch" }] })]);
    const report = await loadKeymapOverrides({
      ...sourceOf({}),
      list: async () => {
        throw new Error("I/O error");
      },
    });

    expect(report.unavailable).toBe("could not list files: I/O error");
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Could not list keymap override files",
      expect.objectContaining({ error: "I/O error" }),
    );
    expect(findBinding(resolveInputProfile("keypad"), press({ key: "F1" }))?.action).toBe("openSearch");
  });

  it("reads nothing off Android", async () => {
    const report = await loadKeymapOverrides(null);
    expect(report).toEqual({ identity: null, applied: [], skipped: [], unavailable: "only read on Android" });
  });
});
