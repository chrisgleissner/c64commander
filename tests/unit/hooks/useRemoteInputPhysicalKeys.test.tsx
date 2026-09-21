/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRemoteInputPhysicalKeys, type RemoteInputPhysicalKeysOptions } from "@/hooks/useRemoteInputPhysicalKeys";
import type { KeyboardInputName } from "@/lib/c64api";
import type { AvMirrorImmersiveHandle } from "@/components/streams/AvMirrorImmersive";
import { DIAMOND8_BINDING } from "@/lib/remoteInput/joystickKeyBindings";

type FunctionKey = "F1" | "F3";

const keyEvent = (key: FunctionKey, repeat = false) =>
  ({ key, code: key, repeat, preventDefault: vi.fn() }) as unknown as ReactKeyboardEvent<HTMLDivElement>;

const mirrorIn = (mode: "drive" | "adjust") =>
  ({ current: { getMode: () => mode } as unknown as AvMirrorImmersiveHandle }) as const;

const setup = (overrides: Partial<RemoteInputPhysicalKeysOptions> = {}) => {
  const setHeldKeyboardInputs = vi.fn();
  const sendSpecialKey = vi.fn();
  const options: RemoteInputPhysicalKeysOptions = {
    outputMode: "joystick",
    heldJoystickInputs: new Set(),
    setHeldJoystickInputs: vi.fn(),
    releaseAllEpoch: 0,
    mirrorRef: { current: null },
    binding: DIAMOND8_BINDING,
    rotation: 0,
    tier: "full",
    heldKeyboardInputs: new Set(),
    setHeldKeyboardInputs,
    sendSpecialKey,
    ...overrides,
  };
  const hook = renderHook((props: RemoteInputPhysicalKeysOptions) => useRemoteInputPhysicalKeys(props), {
    initialProps: options,
  });
  const press = (key: FunctionKey, repeat = false) =>
    act(() => hook.result.current.handleKeyDown(keyEvent(key, repeat)));
  const release = (key: FunctionKey) => act(() => hook.result.current.handleKeyUp(keyEvent(key)));
  return { hook, options, press, release, setHeldKeyboardInputs, sendSpecialKey };
};

describe("useRemoteInputPhysicalKeys function keys", () => {
  it("holds F1 on the full tier until key-up, keeping keyboard keys held by another source", () => {
    const { press, release, setHeldKeyboardInputs } = setup({
      heldKeyboardInputs: new Set<KeyboardInputName>(["return"]),
    });

    press("F1");
    expect(setHeldKeyboardInputs).toHaveBeenLastCalledWith(new Set(["return", "f1"]));

    release("F1");
    expect(setHeldKeyboardInputs).toHaveBeenLastCalledWith(new Set(["return"]));
  });

  it("keeps F1 held when F3 is pressed in the same event turn before the held set re-renders", () => {
    const { hook, setHeldKeyboardInputs } = setup();

    act(() => {
      hook.result.current.handleKeyDown(keyEvent("F1"));
      hook.result.current.handleKeyDown(keyEvent("F3"));
    });

    expect(setHeldKeyboardInputs).toHaveBeenLastCalledWith(new Set(["f1", "f3"]));
  });

  it("ignores OS auto-repeat and a second key-down while the function key is already held", () => {
    const { press, setHeldKeyboardInputs } = setup();

    press("F1");
    press("F1", true);
    press("F1");

    expect(setHeldKeyboardInputs).toHaveBeenCalledTimes(1);
  });

  it("ignores an auto-repeat whose initial key-down arrived before the sheet was listening", () => {
    const { press, setHeldKeyboardInputs } = setup();

    press("F1", true);

    expect(setHeldKeyboardInputs).not.toHaveBeenCalled();
  });

  it("injects one special key on the KERNAL fallback tier and does nothing on key-up", () => {
    const { press, release, sendSpecialKey, setHeldKeyboardInputs } = setup({ tier: "kernal-fallback" });

    press("F3");
    release("F3");

    expect(sendSpecialKey).toHaveBeenCalledTimes(1);
    expect(sendSpecialKey).toHaveBeenCalledWith("f3");
    expect(setHeldKeyboardInputs).not.toHaveBeenCalled();
  });

  it("sends nothing while authentication is required", () => {
    const { press, release, sendSpecialKey, setHeldKeyboardInputs } = setup({ tier: "auth-required" });

    press("F1");
    release("F1");

    expect(sendSpecialKey).not.toHaveBeenCalled();
    expect(setHeldKeyboardInputs).not.toHaveBeenCalled();
  });

  it("sends nothing while the mirror view is being adjusted, but does once the view is driving", () => {
    const { press, setHeldKeyboardInputs } = setup({ mirrorRef: mirrorIn("adjust") });
    press("F1");
    expect(setHeldKeyboardInputs).not.toHaveBeenCalled();

    const driving = setup({ mirrorRef: mirrorIn("drive") });
    driving.press("F1");
    expect(driving.setHeldKeyboardInputs).toHaveBeenCalledWith(new Set(["f1"]));
  });

  it("treats key-up of a function key that was never pressed as a no-op", () => {
    const { release, setHeldKeyboardInputs } = setup({
      heldKeyboardInputs: new Set<KeyboardInputName>(["f3"]),
    });

    release("F3");

    expect(setHeldKeyboardInputs).not.toHaveBeenCalled();
  });

  it("forgets a held function key on a release-all, so the next key-down is sent again", () => {
    const { hook, options, press, setHeldKeyboardInputs } = setup();

    press("F1");
    hook.rerender({ ...options, releaseAllEpoch: 1 });
    press("F1");

    expect(setHeldKeyboardInputs).toHaveBeenCalledTimes(2);
  });
});
