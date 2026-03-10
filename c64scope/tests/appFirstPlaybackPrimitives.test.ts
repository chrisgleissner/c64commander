/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";

const dumpUiHierarchyMock = vi.fn();
const tapByTextMock = vi.fn();
const tapByTextContainingMock = vi.fn();
const tapByResourceIdMock = vi.fn();

vi.mock("../src/validation/helpers.js", () => ({
  dumpUiHierarchy: dumpUiHierarchyMock,
}));

vi.mock("../src/validation/appFirstPrimitives.js", () => ({
  tapByText: tapByTextMock,
  tapByTextContaining: tapByTextContainingMock,
  tapByResourceId: tapByResourceIdMock,
}));

describe("app-first playback primitives", () => {
  it("opens add-items dialogs, chooses sources, opens path segments, and confirms add", async () => {
    const {
      chooseSource,
      confirmAddItems,
      openAddItemsDialog,
      openPathSegments,
    } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Select items" class="android.widget.TextView" enabled="true" bounds="[110,561][968,629]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2" class="android.widget.TextView" enabled="true" bounds="[176,1001][415,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2" class="android.widget.TextView" enabled="true" bounds="[176,1001][415,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2" class="android.widget.TextView" enabled="true" bounds="[176,1001][415,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2/test-data" class="android.widget.TextView" enabled="true" bounds="[176,1001][415,1058]" />
        </hierarchy>
      `);
    tapByResourceIdMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    tapByTextMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    tapByTextContainingMock.mockResolvedValueOnce(false);

    const client = { tap: vi.fn(), pressKey: vi.fn(), inputText: vi.fn(), swipe: vi.fn() };

    await openAddItemsDialog(client as never, "serial-1");
    await chooseSource(client as never, "serial-1", ["Missing", "C64U"]);
    await openPathSegments(client as never, "serial-1", ["USB2", "test-data"]);
    await confirmAddItems(client as never, "serial-1");
  });

  it("dismisses the connection-status overlay before opening Add items", async () => {
    const { openAddItemsDialog } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    tapByResourceIdMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await openAddItemsDialog(client as never, "serial-1");

    expect(tapByResourceIdMock).toHaveBeenNthCalledWith(1, client, "serial-1", "connection-status-close");
    expect(tapByResourceIdMock).toHaveBeenNthCalledWith(2, client, "serial-1", "add-items-to-playlist");
  });

  it("scrolls the C64U picker until an off-screen path segment becomes reachable", async () => {
    const { openPathSegments } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2" class="android.widget.TextView" enabled="true" bounds="[176,1001][415,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2/test-data" class="android.widget.TextView" enabled="true" bounds="[176,1001][470,1058]" />
        </hierarchy>
      `);
    tapByTextMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    tapByTextContainingMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await openPathSegments(client as never, "serial-1", ["USB2", "test-data"]);

    expect(client.swipe).toHaveBeenCalledWith("serial-1", 540, 1620, 540, 1080, 260);
  });

  it("prefers explicit picker folder rows like 'Open SID' over unrelated visible SID labels", async () => {
    const { openPathSegments } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2/test-data/mod" class="android.widget.TextView" enabled="true" bounds="[176,1001][560,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /" class="android.widget.TextView" enabled="true" bounds="[176,1001][250,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2" class="android.widget.TextView" enabled="true" bounds="[176,1001][415,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2/test-data" class="android.widget.TextView" enabled="true" bounds="[176,1001][470,1058]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2/test-data/SID" class="android.widget.TextView" enabled="true" bounds="[176,1001][520,1058]" />
        </hierarchy>
      `);
    tapByTextMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await openPathSegments(client as never, "serial-1", ["USB2", "test-data", "SID"]);

    expect(tapByTextMock).toHaveBeenCalledWith(client, "serial-1", "Open SID");
    expect(tapByTextContainingMock).not.toHaveBeenCalled();
  });

  it("treats an already-visible C64U picker as a satisfied source selection", async () => {
    const { chooseSource } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Path: /USB2/test-data/mod" class="android.widget.TextView" enabled="true" bounds="[176,1001][560,1058]" />
        </hierarchy>
      `);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await chooseSource(client as never, "serial-1", ["C64U"]);

    expect(tapByResourceIdMock).not.toHaveBeenCalled();
    expect(tapByTextMock).not.toHaveBeenCalled();
    expect(tapByTextContainingMock).not.toHaveBeenCalled();
  });

  it("treats a pathless but visible picker selection UI as a satisfied C64U source selection", async () => {
    const { chooseSource } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Select items" class="android.widget.TextView" enabled="true" bounds="[160,280][520,340]" />
          <node text="0 selected" class="android.widget.TextView" enabled="true" bounds="[160,350][420,410]" />
        </hierarchy>
      `);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await chooseSource(client as never, "serial-1", ["C64U"]);

    expect(tapByResourceIdMock).not.toHaveBeenCalled();
    expect(tapByTextMock).not.toHaveBeenCalled();
    expect(tapByTextContainingMock).not.toHaveBeenCalled();
  });

  it("prefers dialog-specific C64U source labels over the generic top-bar C64U token", async () => {
    const { chooseSource } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    tapByResourceIdMock.mockResolvedValueOnce(false);
    tapByTextMock.mockResolvedValueOnce(false);
    tapByTextContainingMock.mockResolvedValueOnce(true);
    dumpUiHierarchyMock
      .mockResolvedValueOnce(`<hierarchy></hierarchy>`)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Select items" class="android.widget.TextView" enabled="true" bounds="[160,280][520,340]" />
          <node text="0 selected" class="android.widget.TextView" enabled="true" bounds="[160,350][420,410]" />
        </hierarchy>
      `);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await chooseSource(client as never, "serial-1", ["C64U"]);

    expect(tapByTextMock).toHaveBeenCalledWith(client, "serial-1", "Add file / folder from C64U");
    expect(tapByTextContainingMock).toHaveBeenCalledWith(client, "serial-1", "Add file / folder from C64U");
    expect(tapByTextMock).not.toHaveBeenCalledWith(client, "serial-1", "C64U");
  });

  it("targets entry checkboxes, edits duration, and reads topmost current track labels", async () => {
    const {
      readTopmostTrackLabel,
      setDurationSeconds,
      tapCheckboxForText,
      waitForTrackLabel,
    } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="0 selected" class="android.widget.TextView" enabled="true" bounds="[110,627][968,673]" />
          <node text="Tune.sid" class="android.widget.TextView" enabled="true" bounds="[160,420][480,480]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="1 selected" class="android.widget.TextView" enabled="true" bounds="[110,627][968,673]" />
          <node text="Tune.sid" class="android.widget.TextView" enabled="true" bounds="[160,420][480,480]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Default duration" class="android.widget.TextView" enabled="true" bounds="[40,200][260,260]" />
          <node text="Songlengths file" class="android.widget.TextView" enabled="true" bounds="[40,320][260,380]" />
          <node text="3:00" class="android.widget.EditText" enabled="true" bounds="[800,200][980,260]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Second.sid" class="android.widget.TextView" enabled="true" bounds="[140,260][460,320]" />
          <node text="First.sid" class="android.widget.TextView" enabled="true" bounds="[140,760][460,820]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="First.sid" class="android.widget.TextView" enabled="true" bounds="[140,760][460,820]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Second.sid" class="android.widget.TextView" enabled="true" bounds="[140,260][460,320]" />
        </hierarchy>
      `);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await tapCheckboxForText(client as never, "serial-1", "Tune.sid");
    expect(client.tap).toHaveBeenCalledWith("serial-1", 96, 450);

    await setDurationSeconds(client as never, "serial-1", 5);
    expect(client.pressKey).toHaveBeenCalledWith("serial-1", 123);
    expect(client.inputText).toHaveBeenCalledWith("serial-1", "5");
    expect(tapByTextMock).toHaveBeenCalledWith(client, "serial-1", "Don't allow");

    expect(await readTopmostTrackLabel("serial-1", ["First.sid", "Second.sid"])).toBe("Second.sid");
    await expect(waitForTrackLabel("serial-1", "Second.sid", ["First.sid", "Second.sid"], 2, 1)).resolves.toBe(
      "Second.sid",
    );
  });

  it("falls back across add-items labels and blur targets", async () => {
    const { openAddItemsDialog, readTopmostTrackLabel, setDurationSeconds } = await import(
      "../src/validation/appFirstPlaybackPrimitives.js"
    );

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    tapByResourceIdMock.mockResolvedValueOnce(false);
    tapByTextMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    tapByTextContainingMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
      <hierarchy>
        <node text="Default duration" class="android.widget.TextView" enabled="true" bounds="[40,200][260,260]" />
        <node text="4" class="android.widget.EditText" enabled="true" bounds="[800,200][980,260]" />
      </hierarchy>
    `);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await openAddItemsDialog(client as never, "serial-1");
    await setDurationSeconds(client as never, "serial-1", 9);

    expect(client.tap).toHaveBeenLastCalledWith("serial-1", 150, 230);

    dumpUiHierarchyMock.mockResolvedValueOnce(`
      <hierarchy>
        <node text="9" class="android.widget.EditText" enabled="true" bounds="[800,200][980,260]" />
      </hierarchy>
    `);
    await setDurationSeconds(client as never, "serial-1", 7);
    expect(client.tap).toHaveBeenLastCalledWith("serial-1", 980, 230);

    dumpUiHierarchyMock.mockResolvedValueOnce(`<hierarchy></hierarchy>`);
    await expect(readTopmostTrackLabel("serial-1", ["Missing.sid"])).resolves.toBeNull();
  });

  it("retries checkbox taps with a deeper left offset when the selected count does not change", async () => {
    const { tapCheckboxForText } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="0 selected" class="android.widget.TextView" enabled="true" bounds="[110,627][968,673]" />
          <node text="Tune.sid" class="android.widget.TextView" enabled="true" bounds="[160,420][480,480]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="0 selected" class="android.widget.TextView" enabled="true" bounds="[110,627][968,673]" />
          <node text="Tune.sid" class="android.widget.TextView" enabled="true" bounds="[160,420][480,480]" />
        </hierarchy>
      `)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="1 selected" class="android.widget.TextView" enabled="true" bounds="[110,627][968,673]" />
          <node text="Tune.sid" class="android.widget.TextView" enabled="true" bounds="[160,420][480,480]" />
        </hierarchy>
      `);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await tapCheckboxForText(client as never, "serial-1", "Tune.sid");

    expect(client.tap).toHaveBeenNthCalledWith(1, "serial-1", 96, 450);
    expect(client.tap).toHaveBeenNthCalledWith(2, "serial-1", 88, 450);
  });

  it("accepts delayed C64U picker readiness once selection UI appears without a path label", async () => {
    const { chooseSource } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    tapByResourceIdMock.mockResolvedValueOnce(true);
    dumpUiHierarchyMock
      .mockResolvedValueOnce(`<hierarchy></hierarchy>`)
      .mockResolvedValueOnce(`<hierarchy></hierarchy>`)
      .mockResolvedValueOnce(`
        <hierarchy>
          <node text="Select items" class="android.widget.TextView" enabled="true" bounds="[160,280][520,340]" />
          <node text="0 selected" class="android.widget.TextView" enabled="true" bounds="[160,350][420,410]" />
        </hierarchy>
        `);

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await chooseSource(client as never, "serial-1", ["C64U"]);

    expect(tapByResourceIdMock).toHaveBeenCalledWith(client, "serial-1", "import-option-c64u");
  });

  it("raises clear errors when required UI affordances are missing", async () => {
    const {
      chooseSource,
      confirmAddItems,
      openAddItemsDialog,
      openPathSegments,
      setDurationSeconds,
      tapCheckboxForText,
      waitForTrackLabel,
    } = await import("../src/validation/appFirstPlaybackPrimitives.js");

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      inputText: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    tapByTextMock.mockReset();
    tapByTextContainingMock.mockReset();
    tapByResourceIdMock.mockReset();
    dumpUiHierarchyMock.mockReset();
    tapByTextMock.mockResolvedValue(false);
    tapByTextContainingMock.mockResolvedValue(false);
    tapByResourceIdMock.mockResolvedValue(false);
    dumpUiHierarchyMock.mockResolvedValue(`<hierarchy></hierarchy>`);
    await expect(openAddItemsDialog(client as never, "serial-1")).rejects.toThrow(/Could not open the Add items dialog/);
    await expect(chooseSource(client as never, "serial-1", ["Missing"])).rejects.toThrow(/Could not select any source option/);
    await expect(openPathSegments(client as never, "serial-1", ["USB2"])).rejects.toThrow(/Could not open path segment/);
    await expect(confirmAddItems(client as never, "serial-1")).rejects.toThrow(/Could not confirm the Add items dialog/);

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`<hierarchy></hierarchy>`);
    await expect(tapCheckboxForText(client as never, "serial-1", "Tune.sid")).rejects.toThrow(/Could not find selectable row/);

    dumpUiHierarchyMock.mockResolvedValueOnce(`
      <hierarchy>
        <node text="Tune.sid" class="android.widget.TextView" enabled="true" bounds="[bad]" />
      </hierarchy>
    `);
    await expect(tapCheckboxForText(client as never, "serial-1", "Tune.sid")).rejects.toThrow(/Could not find selectable row/);

    dumpUiHierarchyMock.mockResolvedValueOnce(`<hierarchy></hierarchy>`);
    await expect(setDurationSeconds(client as never, "serial-1", 5)).rejects.toThrow(/Could not find the duration input field/);

    dumpUiHierarchyMock.mockResolvedValueOnce(`
      <hierarchy>
        <node text="5" class="android.widget.EditText" enabled="true" bounds="[bad]" />
      </hierarchy>
    `);
    await expect(setDurationSeconds(client as never, "serial-1", 5)).rejects.toThrow(/Could not find the duration input field/);

    dumpUiHierarchyMock.mockResolvedValueOnce(`
      <hierarchy>
        <node text="First.sid" class="android.widget.TextView" enabled="true" bounds="[140,760][460,820]" />
      </hierarchy>
    `);
    await expect(waitForTrackLabel("serial-1", "Second.sid", ["First.sid", "Second.sid"], 1, 1)).rejects.toThrow(
      /Expected current track 'Second.sid', observed 'First.sid'/,
    );
  });
});
