/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FocusNavigationProvider, useFocusItem, useFocusNavigation } from "@/hooks/useFocusNavigation";
import { NavigationController } from "@/lib/input";

/**
 * Integration coverage for the React adapter that drives keypad-only navigation:
 * it renders real CTAs registered through {@link useFocusItem}, fires the same
 * key events the device emits, and asserts focus moves / activations / back-chain
 * behaviour — proving the pure `@/lib/input` layer is wired to the DOM correctly.
 */

type ToolbarProps = {
  readonly onA: () => void;
  readonly onB: () => void;
};

/** Two enabled CTAs (A, B) and a disabled one (C) the controller must skip. */
const Toolbar = ({ onA, onB }: ToolbarProps) => {
  const aRef = useFocusItem<HTMLButtonElement>({ id: "a", order: 10 });
  const bRef = useFocusItem<HTMLButtonElement>({ id: "b", order: 20 });
  const cRef = useFocusItem<HTMLButtonElement>({ id: "c", order: 30, disabled: true });
  return (
    <>
      <button ref={aRef} onClick={onA}>
        A
      </button>
      <button ref={bRef} onClick={onB}>
        B
      </button>
      <button ref={cRef} disabled onClick={() => {}}>
        C
      </button>
    </>
  );
};

describe("FocusNavigationProvider + useFocusItem", () => {
  it("moves d-pad focus across enabled CTAs, skipping disabled ones and wrapping", () => {
    const { getByText } = render(
      <FocusNavigationProvider>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(getByText("B"));

    // Forward from B wraps past the disabled C back to A.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(getByText("A"));

    // Backward from A also skips the disabled C and lands on B.
    fireEvent.keyDown(document.body, { code: "ArrowUp" });
    expect(document.activeElement).toBe(getByText("B"));

    // Back with nothing to dismiss and no onNavigateBack handler must not throw.
    expect(() => fireEvent.keyDown(document.body, { code: "Escape" })).not.toThrow();
  });

  it("activates the focused CTA via center/enter (default = click the element)", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <FocusNavigationProvider>
        <Toolbar onA={onA} onB={onB} />
      </FocusNavigationProvider>,
    );

    // Selection starts on the first enabled item (A); Enter activates it.
    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(onA).toHaveBeenCalledTimes(1);

    // Move to B and activate with Space (center).
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { code: "Space" });
    expect(onB).toHaveBeenCalledTimes(1);
    expect(onA).toHaveBeenCalledTimes(1);
  });

  it("uses a custom onActivate instead of clicking the element", () => {
    const onActivate = vi.fn();
    const onClick = vi.fn();
    const Custom = () => {
      const ref = useFocusItem<HTMLButtonElement>({ id: "x", order: 10, onActivate });
      return (
        <button ref={ref} onClick={onClick}>
          X
        </button>
      );
    };
    render(
      <FocusNavigationProvider>
        <Custom />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("invokes onNavigateBack when back is pressed with nothing to dismiss", () => {
    const onNavigateBack = vi.fn();
    render(
      <FocusNavigationProvider onNavigateBack={onNavigateBack}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(onNavigateBack).toHaveBeenCalledTimes(1);
  });

  it("does not steal keys from editable targets (input, textarea, contenteditable)", () => {
    const WithFields = () => {
      const aRef = useFocusItem<HTMLButtonElement>({ id: "a", order: 10 });
      return (
        <>
          <button ref={aRef} onClick={() => {}}>
            A
          </button>
          <input aria-label="host" />
          <div aria-label="note" contentEditable role="textbox" tabIndex={0} suppressContentEditableWarning />
        </>
      );
    };
    const { getByLabelText } = render(
      <FocusNavigationProvider>
        <WithFields />
      </FocusNavigationProvider>,
    );

    const input = getByLabelText("host") as HTMLInputElement;
    input.focus();
    // The field keeps the key (default not prevented) and focus does not move to A.
    expect(fireEvent.keyDown(input, { code: "ArrowDown" })).toBe(true);
    expect(document.activeElement).toBe(input);

    const note = getByLabelText("note") as HTMLDivElement;
    note.focus();
    expect(fireEvent.keyDown(note, { code: "ArrowDown" })).toBe(true);
    expect(document.activeElement).toBe(note);
  });

  it("prevents default only for actions it consumes", () => {
    const Custom = () => {
      const ref = useFocusItem<HTMLButtonElement>({ id: "x", order: 10 });
      return (
        <button ref={ref} onClick={() => {}}>
          X
        </button>
      );
    };
    render(
      <FocusNavigationProvider>
        <Custom />
      </FocusNavigationProvider>,
    );

    // ArrowDown is consumed (focus move) → default prevented (dispatch returns false).
    expect(fireEvent.keyDown(document.body, { code: "ArrowDown" })).toBe(false);
    // Events on the document (a non-element target) are still navigated normally.
    expect(fireEvent.keyDown(document, { code: "ArrowDown" })).toBe(false);
    // ArrowLeft → dpadLeft is owned by the focused widget → ignored → not prevented.
    expect(fireEvent.keyDown(document.body, { code: "ArrowLeft" })).toBe(true);
    // An unbound key resolves to no action → not prevented.
    expect(fireEvent.keyDown(document.body, { code: "KeyQ", key: "q" })).toBe(true);
  });

  it("detaches the global listener when disabled", () => {
    const onA = vi.fn();
    render(
      <FocusNavigationProvider enabled={false}>
        <Toolbar onA={onA} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    expect(fireEvent.keyDown(document.body, { code: "Enter" })).toBe(true);
    expect(onA).not.toHaveBeenCalled();
  });

  it("honours the selected input profile (keypad codes)", () => {
    const onB = vi.fn();
    const { getByText } = render(
      <FocusNavigationProvider profileId="keypad">
        <Toolbar onA={vi.fn()} onB={onB} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(getByText("B"));
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(onB).toHaveBeenCalledTimes(1);
  });

  it("unregisters a CTA when it unmounts", () => {
    const Switchable = ({ show }: { show: boolean }) => {
      const aRef = useFocusItem<HTMLButtonElement>({ id: "a", order: 10 });
      const bRef = useFocusItem<HTMLButtonElement>({ id: "b", order: 20 });
      return (
        <>
          <button ref={aRef} onClick={() => {}}>
            A
          </button>
          {show && (
            <button ref={bRef} onClick={() => {}}>
              B
            </button>
          )}
        </>
      );
    };

    const { rerender, getByText, queryByText } = render(
      <FocusNavigationProvider>
        <Switchable show />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(getByText("B"));

    rerender(
      <FocusNavigationProvider>
        <Switchable show={false} />
      </FocusNavigationProvider>,
    );
    expect(queryByText("B")).toBeNull();

    // With B gone the only enabled item is A, so forward navigation stays on A.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(getByText("A"));
  });

  it("exposes the controller via useFocusNavigation (null outside a provider)", () => {
    let insideResult: NavigationController | null | undefined;
    let outsideResult: NavigationController | null | undefined;
    const Inside = () => {
      insideResult = useFocusNavigation();
      return null;
    };
    const Outside = () => {
      outsideResult = useFocusNavigation();
      return null;
    };

    render(
      <FocusNavigationProvider>
        <Inside />
      </FocusNavigationProvider>,
    );
    render(<Outside />);

    expect(insideResult).toBeInstanceOf(NavigationController);
    expect(outsideResult).toBeNull();
  });

  it("renders a useFocusItem consumer with no provider as a harmless no-op", () => {
    const Lonely = () => {
      const ref = useFocusItem<HTMLButtonElement>({ id: "lonely", order: 0 });
      return (
        <button ref={ref} onClick={() => {}}>
          Lonely
        </button>
      );
    };
    const { getByText } = render(<Lonely />);

    expect(getByText("Lonely")).toBeInTheDocument();
    // No provider → no global listener → key press changes nothing and does not throw.
    expect(fireEvent.keyDown(document.body, { code: "ArrowDown" })).toBe(true);
  });
});
