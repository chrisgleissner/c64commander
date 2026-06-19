import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useT9Input, type UseT9InputOptions } from "@/hooks/useT9Input";

type KeyInit = { code?: string; key?: string; shiftKey?: boolean };

const makeEvent = (init: KeyInit) =>
  ({
    code: init.code ?? "",
    key: init.key ?? "",
    keyCode: 0,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: init.shiftKey ?? false,
    preventDefault: () => {},
  }) as unknown as React.KeyboardEvent<HTMLInputElement>;

/**
 * Drives the hook like a controlled input: each composed value is fed back in
 * on the next render, exactly as a parent component would.
 */
const createDriver = (options: Omit<UseT9InputOptions, "value" | "setValue">) => {
  const state = { value: "" };
  const props = (): UseT9InputOptions => ({ ...options, value: state.value, setValue: (next) => (state.value = next) });
  const view = renderHook((p: UseT9InputOptions) => useT9Input(p), { initialProps: props() });
  const press = (init: KeyInit) => {
    act(() => view.result.current.onKeyDown(makeEvent(init)));
    view.rerender(props());
  };
  return { state, view, press };
};

describe("useT9Input", () => {
  it("enters an IPv4 address in hostname mode using only keypad events", () => {
    let now = 1000;
    const { state, press } = createDriver({ mode: "hostname", now: () => now });
    const digit = (d: number) => press({ code: `Digit${d}`, key: String(d) });
    const dot = () => press({ key: "*", code: "NumpadMultiply" });

    // "192.168.1.13": digits insert directly, star inserts "." (first separator).
    [1, 9, 2].forEach(digit);
    dot();
    now += 1; // ensure separate from the previous star
    [1, 6, 8].forEach(digit);
    dot();
    digit(1);
    dot();
    [1, 3].forEach(digit);

    expect(state.value).toBe("192.168.1.13");
  });

  it("appends a port via two star presses (':') in hostname mode", () => {
    const now = 5000;
    const { state, press } = createDriver({ mode: "hostname", now: () => now });
    press({ code: "Digit8", key: "8" });
    press({ code: "Digit0", key: "0" });
    // Two quick star presses cycle "." -> ":".
    press({ key: "*" });
    press({ key: "*" });
    [8, 0].forEach((d) => press({ code: `Digit${d}`, key: String(d) }));
    expect(state.value).toBe("80:80");
  });

  it("cycles multi-tap candidates on repeated presses, and commits after the timeout", () => {
    let now = 1000;
    const { state, press } = createDriver({ mode: "multitap", now: () => now });

    press({ code: "Digit2", key: "2" }); // "a"
    expect(state.value).toBe("a");
    now += 100; // within the 800ms window
    press({ code: "Digit2", key: "2" }); // cycles a -> b
    expect(state.value).toBe("b");
    now += 1000; // past the window -> new character
    press({ code: "Digit2", key: "2" }); // "a"
    expect(state.value).toBe("ba");
  });

  it("toggles between hostname and multitap modes via the hash key", () => {
    const { view, press } = createDriver({ mode: "hostname", now: () => 1 });
    expect(view.result.current.mode).toBe("hostname");
    press({ key: "#" });
    expect(view.result.current.mode).toBe("multitap");
    press({ key: "#" });
    expect(view.result.current.mode).toBe("hostname");
  });

  it("passes non-composer keys through untouched (does not consume them)", () => {
    const { state, press } = createDriver({ mode: "hostname", now: () => 1 });
    // Letters/arrows/Enter are not composer keys; the value stays empty because
    // the hook does not synthesize them (native typing would handle letters).
    press({ code: "KeyC", key: "c" });
    press({ code: "ArrowLeft", key: "ArrowLeft" });
    press({ code: "Enter", key: "Enter" });
    expect(state.value).toBe("");
  });

  it("is inert when disabled", () => {
    const { state, press } = createDriver({ mode: "hostname", enabled: false, now: () => 1 });
    press({ code: "Digit5", key: "5" });
    expect(state.value).toBe("");
  });
});
