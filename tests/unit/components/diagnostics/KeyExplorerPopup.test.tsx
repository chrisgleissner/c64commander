/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitKeyInputDiagnostics = vi.hoisted(() => vi.fn());
vi.mock("@/lib/diagnostics/keyInputDiagnostics", () => ({ emitKeyInputDiagnostics }));

const toasts = vi.hoisted(() => [] as Array<{ title?: string; description?: string }>);
vi.mock("@/hooks/use-toast", () => ({
  toast: (input: { title?: string; description?: string }) => toasts.push(input),
}));

const keymapFiles = vi.hoisted(() => ({ files: {} as Record<string, string>, listError: null as Error | null }));
vi.mock("@/lib/native/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/platform")>()),
  isNativePlatform: () => true,
  getPlatform: () => "android",
}));
const reloadFailure = vi.hoisted(() => ({ current: null as Error | null }));
vi.mock("@/lib/input/keymapOverrideFiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/input/keymapOverrideFiles")>();
  return {
    ...actual,
    loadKeymapOverrides: (...args: Parameters<typeof actual.loadKeymapOverrides>) =>
      reloadFailure.current ? Promise.reject(reloadFailure.current) : actual.loadKeymapOverrides(...args),
  };
});
vi.mock("@/lib/native/diagnosticsBridge", () => ({
  getNativeDeviceIdentity: async () => ({ manufacturer: "Acme", model: "K100", device: "k100" }),
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readdir: async () => {
      if (keymapFiles.listError) throw keymapFiles.listError;
      return { files: Object.keys(keymapFiles.files).map((name) => ({ name, type: "file" })) };
    },
    readFile: async ({ path }: { path: string }) => ({ data: keymapFiles.files[path.replace("keymaps/", "")] }),
  },
}));

import { KeyExplorerPopup } from "@/components/diagnostics/KeyExplorerPopup";
import { formatObservations, observeKey, redactKey } from "@/lib/diagnostics/keyExplorer";
import { keypadProfile } from "@/lib/input/profiles/keypad";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import { installKeymapOverrides } from "@/lib/input/keymapOverrides";
import { loadKeymapOverrides } from "@/lib/input/keymapOverrideFiles";

const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);

describe("Key Explorer", () => {
  beforeEach(() => {
    localStorage.clear();
    emitKeyInputDiagnostics.mockClear();
  });

  /*
   * It cannot reuse the existing key diagnostics: those emit only when debug logging is on, and
   * this panel is most needed on a handset nobody has put into debug mode.
   */
  it("records keys with debug logging OFF", () => {
    expect(loadDebugLoggingEnabled()).toBe(false);
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("code=F1");
  });

  it("shows what a key resolves to, and says so when it resolves to nothing", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("resolves to function1");

    press({ code: "F9", key: "F9", keyCode: 120 });
    expect(screen.getAllByTestId("key-explorer-action")[0].textContent).toBe("resolves to nothing");
  });

  it("reports an empty code, which is what an Android WebView sends for a keypad digit", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "", key: "7", keyCode: 55 });
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("code=<empty>");
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("keyCode=55");
  });

  describe("keymap override files", () => {
    beforeEach(() => {
      keymapFiles.files = {};
      keymapFiles.listError = null;
      toasts.length = 0;
    });
    afterEach(() => installKeymapOverrides([]));

    it("reloads the files on demand, lists them, and resolves keys through the new binding", async () => {
      await act(() => loadKeymapOverrides());
      render(<KeyExplorerPopup open onClose={() => undefined} />);
      expect(screen.getByTestId("key-explorer-device").textContent).toContain('model "K100"');
      expect(screen.getByTestId("key-explorer-overrides-list").textContent).toContain("No keymap files found.");

      keymapFiles.files = {
        "acme.json": JSON.stringify({
          schema: 1,
          match: { model: "K100" },
          bindings: [{ keyCode: 142, action: "openSearch" }],
        }),
        "pixel.json": JSON.stringify({ schema: 1, match: { model: "Pixel 4" }, bindings: [] }),
      };
      fireEvent.click(screen.getByTestId("key-explorer-reload-keymaps"));

      await waitFor(() =>
        expect(toasts).toContainEqual({ title: "Keymap files reloaded", description: "1 applied, 1 skipped." }),
      );
      const list = screen.getByTestId("key-explorer-overrides-list").textContent;
      expect(list).toContain("acme.json — applied");
      expect(list).toContain("pixel.json — skipped: for another device");

      press({ code: "", key: "Unidentified", keyCode: 142 });
      expect(screen.getAllByTestId("key-explorer-action")[0].textContent).toBe("resolves to openSearch");
    });

    it("says so, and re-enables the button, when a reload fails", async () => {
      await act(() => loadKeymapOverrides());
      render(<KeyExplorerPopup open onClose={() => undefined} />);
      reloadFailure.current = new Error("bridge gone");

      fireEvent.click(screen.getByTestId("key-explorer-reload-keymaps"));

      await waitFor(() =>
        expect(toasts).toContainEqual({ title: "Could not reload keymap files", description: "bridge gone" }),
      );
      expect(screen.getByTestId("key-explorer-reload-keymaps")).not.toBeDisabled();
      reloadFailure.current = null;
    });

    it("says why nothing was read when the folder cannot be listed", async () => {
      keymapFiles.listError = new Error("I/O error");
      await act(() => loadKeymapOverrides());
      render(<KeyExplorerPopup open onClose={() => undefined} />);

      expect(screen.getByTestId("key-explorer-overrides-unavailable").textContent).toBe(
        "Not read: could not list files: I/O error.",
      );
    });

    it("treats a missing folder as no files", async () => {
      keymapFiles.listError = new Error("Folder does not exist.");
      await act(() => loadKeymapOverrides());
      render(<KeyExplorerPopup open onClose={() => undefined} />);

      expect(screen.getByTestId("key-explorer-overrides-list").textContent).toContain("No keymap files found.");
    });
  });

  describe("privacy", () => {
    it("records no character a key produced", () => {
      render(<KeyExplorerPopup open onClose={() => undefined} />);
      press({ code: "KeyS", key: "s", keyCode: 83 });
      const text = screen.getByTestId("key-explorer-list").textContent ?? "";
      expect(text).toContain("code=KeyS");
      expect(text).toContain("key=<character>");
      expect(text).not.toContain("key=s");
    });

    it("reduces a digit and a space to their shape, not their value", () => {
      expect(redactKey("7")).toBe("<digit>");
      expect(redactKey(" ")).toBe("<space>");
      expect(redactKey("a")).toBe("<character>");
    });

    it("keeps a named key as it is, because the name is the answer being looked for", () => {
      expect(redactKey("Escape")).toBe("Escape");
      expect(redactKey("F1")).toBe("F1");
    });

    it("records nothing from a field's contents, because it records only the event's identity", () => {
      render(<KeyExplorerPopup open onClose={() => undefined} />);
      const input = document.createElement("input");
      input.value = "my-secret-password";
      document.body.appendChild(input);
      fireEvent.keyDown(input, { code: "KeyM", key: "m", keyCode: 77 });
      const text = screen.getByTestId("key-explorer-list").textContent ?? "";
      expect(text).not.toContain("my-secret-password");
      expect(text).not.toContain("key=m");
    });
  });

  it("keeps only the last ten", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    for (let index = 0; index < 15; index += 1) press({ code: `F${index}`, key: `F${index}`, keyCode: 200 + index });
    expect(screen.getByTestId("key-explorer-list").children).toHaveLength(10);
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("code=F14");
    expect(screen.getByTestId("key-explorer-list").textContent).not.toContain("code=F4 ");
  });

  it("stops listening once the panel closes", () => {
    const { rerender } = render(<KeyExplorerPopup open onClose={() => undefined} />);
    rerender(<KeyExplorerPopup open={false} onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    rerender(<KeyExplorerPopup open onClose={() => undefined} />);
    expect(screen.getByTestId("key-explorer-empty")).toBeInTheDocument();
  });

  it("clears the list on request", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    fireEvent.click(screen.getByTestId("key-explorer-clear"));
    expect(screen.getByTestId("key-explorer-empty")).toBeInTheDocument();
  });

  describe("the copyable report", () => {
    it("names the code, the keyCode and what it resolved to", () => {
      const observation = observeKey(new KeyboardEvent("keydown", { code: "F1", key: "F1" }), keypadProfile);
      expect(formatObservations([observation])).toContain("code=F1");
      expect(formatObservations([observation])).toContain("action=function1");
    });

    it("says so plainly when a key resolved to nothing", () => {
      const observation = observeKey(new KeyboardEvent("keydown", { code: "F9", key: "F9" }), keypadProfile);
      expect(formatObservations([observation])).toContain("action=<unbound>");
    });

    it("has something to say with nothing recorded", () => {
      expect(formatObservations([])).toBe("No keys recorded.");
    });
  });
});

/*
 * The copy button where the Clipboard API is absent — a WebView without it, or a page served over
 * plain HTTP. Optional chaining ended the expression with no copy AND no message, so the button
 * did nothing at all and said nothing about it. jsdom provides no clipboard by default, which is
 * exactly the case that had no test.
 */
describe("copying the key list", () => {
  beforeEach(() => {
    toasts.length = 0;
  });

  it("puts the list in a toast where there is no clipboard", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
    Object.defineProperty(globalThis.navigator, "clipboard", { value: undefined, configurable: true });
    try {
      render(<KeyExplorerPopup open onOpenChange={() => undefined} />);
      fireEvent.keyDown(window, { key: "a", code: "KeyA" });

      fireEvent.click(screen.getByTestId("key-explorer-copy"));

      expect(toasts).toHaveLength(1);
      expect(toasts[0].title).toBe("Clipboard not available here");
      expect(toasts[0].description ?? "").not.toBe("");
    } finally {
      if (original) Object.defineProperty(globalThis.navigator, "clipboard", original);
    }
  });
});

/*
 * "Never the character a key produced" has to hold for characters outside the BMP too. A length
 * check in UTF-16 units let an emoji from a soft keyboard through verbatim, into the observation
 * list and into the text the Copy button puts on the clipboard.
 */
describe("redaction", () => {
  it("redacts a character that takes two UTF-16 units", () => {
    expect(redactKey("\u{1F600}")).toBe("<character>");
  });

  it("still keeps the name of a named key", () => {
    expect(redactKey("ArrowUp")).toBe("ArrowUp");
    expect(redactKey("Enter")).toBe("Enter");
  });
});
