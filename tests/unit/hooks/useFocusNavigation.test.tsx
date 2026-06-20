/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FocusNavigationProvider,
  useDismissibleNavigationLayer,
  useFocusItem,
  useFocusNavigation,
} from "@/hooks/useFocusNavigation";
import { NavigationController } from "@/lib/input";
import { saveDebugLoggingEnabled } from "@/lib/config/appSettings";
import { clearLogs, getLogs } from "@/lib/logging";

const SELECTED = "data-key-selected";

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

const NestedToolbar = () => {
  const cardRef = useFocusItem<HTMLButtonElement>({ id: "card", order: 10 });
  const afterRef = useFocusItem<HTMLButtonElement>({ id: "after", order: 20 });
  const primaryRef = useFocusItem<HTMLButtonElement>({ id: "card-primary", order: 10, parentId: "card" });
  const secondaryRef = useFocusItem<HTMLButtonElement>({ id: "card-secondary", order: 20, parentId: "card" });
  return (
    <>
      <button ref={cardRef} onClick={() => {}}>
        Card
      </button>
      <button ref={primaryRef} onClick={() => {}}>
        Primary
      </button>
      <button ref={secondaryRef} onClick={() => {}}>
        Secondary
      </button>
      <button ref={afterRef} onClick={() => {}}>
        After
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

  it("invokes onNavigateBack when the hardware back key is pressed with nothing to dismiss", () => {
    const onNavigateBack = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad" onNavigateBack={onNavigateBack}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "GoBack" });
    expect(onNavigateBack).toHaveBeenCalledTimes(1);
  });

  it("does not navigate the route on Escape with nothing to dismiss", () => {
    const onNavigateBack = vi.fn();
    render(
      <FocusNavigationProvider onNavigateBack={onNavigateBack}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    // Escape only unwinds in-app state; with nothing to dismiss it defers to the
    // browser / an open Radix overlay instead of calling navigate(-1).
    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(onNavigateBack).not.toHaveBeenCalled();
  });

  it("stays inert while focus is inside an open Radix overlay", () => {
    const onActivate = vi.fn();
    const InDialog = () => {
      const ref = useFocusItem<HTMLButtonElement>({ id: "dlg-cta", order: 0, onActivate });
      return (
        <div role="dialog">
          <button ref={ref}>X</button>
        </div>
      );
    };
    const { getByText } = render(
      <FocusNavigationProvider>
        <InDialog />
      </FocusNavigationProvider>,
    );

    // Enter on a CTA inside the dialog must reach the overlay, not the global ring.
    fireEvent.keyDown(getByText("X"), { code: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
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

  it("navigates nested CTA groups with right to descend and left or escape to climb", () => {
    const { getByText } = render(
      <FocusNavigationProvider>
        <NestedToolbar />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowRight" });
    expect(document.activeElement).toBe(getByText("Primary"));
    expect(getByText("Primary")).toHaveAttribute(SELECTED, "true");

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(getByText("Secondary"));
    expect(getByText("Secondary")).toHaveAttribute(SELECTED, "true");

    fireEvent.keyDown(document.body, { code: "ArrowLeft" });
    expect(document.activeElement).toBe(getByText("Card"));
    expect(getByText("Card")).toHaveAttribute(SELECTED, "true");

    fireEvent.keyDown(document.body, { code: "ArrowRight" });
    expect(document.activeElement).toBe(getByText("Primary"));
    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(document.activeElement).toBe(getByText("Card"));
    expect(getByText("Card")).toHaveAttribute(SELECTED, "true");

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(getByText("After"));
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

describe("FocusNavigationProvider — modality + selected-control highlight (Prime Directive)", () => {
  it("flag OFF: a key never sets data-key-selected (byte-for-byte baseline)", () => {
    const { getByText } = render(
      <FocusNavigationProvider enabled={false}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(getByText("A")).not.toHaveAttribute(SELECTED);
    expect(getByText("B")).not.toHaveAttribute(SELECTED);
  });

  it("flag ON: no highlight before a key; highlight on the focused item after a recognized key", () => {
    const { getByText } = render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    // State 2: flag on, pre-key → still no affordance.
    expect(getByText("A")).not.toHaveAttribute(SELECTED);
    expect(getByText("B")).not.toHaveAttribute(SELECTED);

    // State 3: a recognized nav key → modality key-navigation → highlight on B.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(getByText("B")).toHaveAttribute(SELECTED, "true");
    expect(getByText("A")).not.toHaveAttribute(SELECTED);
  });

  it("an unrecognized / ignored key does not flip modality or set the highlight", () => {
    const { getByText } = render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    // ArrowLeft → dpadLeft → ignored by the controller; KeyQ → no binding.
    fireEvent.keyDown(document.body, { code: "ArrowLeft" });
    fireEvent.keyDown(document.body, { code: "KeyQ", key: "q" });
    expect(getByText("A")).not.toHaveAttribute(SELECTED);
    expect(getByText("B")).not.toHaveAttribute(SELECTED);
  });

  it("the highlight moves to the new item on each focus change", () => {
    const { getByText } = render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" }); // → B
    expect(getByText("B")).toHaveAttribute(SELECTED, "true");
    fireEvent.keyDown(document.body, { code: "ArrowDown" }); // wraps → A
    expect(getByText("A")).toHaveAttribute(SELECTED, "true");
    expect(getByText("B")).not.toHaveAttribute(SELECTED);
  });

  it("State 4: a pointer/touch interaction clears the highlight the same frame", () => {
    const { getByText } = render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(getByText("B")).toHaveAttribute(SELECTED, "true");

    fireEvent.pointerDown(document.body);
    expect(getByText("B")).not.toHaveAttribute(SELECTED);
  });

  it("clears the highlight when the flag is turned off", () => {
    const { getByText, rerender } = render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(getByText("B")).toHaveAttribute(SELECTED, "true");

    rerender(
      <FocusNavigationProvider enabled={false}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    expect(getByText("B")).not.toHaveAttribute(SELECTED);
  });
});

describe("useDismissibleNavigationLayer (dropdown/layer gating, HAZARD 2)", () => {
  const Dropdown = ({ open, dismiss }: { open: boolean; dismiss: () => void }) => {
    useDismissibleNavigationLayer(open, { dismiss });
    return null;
  };
  const Capture = ({ onController }: { onController: (c: NavigationController | null) => void }) => {
    onController(useFocusNavigation());
    return null;
  };

  it("pushes a layer while open so vertical nav is suppressed; back dismisses it", () => {
    let controller: NavigationController | null = null;
    const dismiss = vi.fn();
    const tree = (open: boolean) => (
      <FocusNavigationProvider enabled>
        <Capture onController={(c) => (controller = c)} />
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
        <Dropdown open={open} dismiss={dismiss} />
      </FocusNavigationProvider>
    );
    const { getByText, rerender } = render(tree(false));
    expect(controller?.layerDepth).toBe(0);

    rerender(tree(true));
    expect(controller?.layerDepth).toBe(1);

    // With the layer open the underlying ring must not move on Down (HAZARD 2).
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).not.toBe(getByText("B"));

    // The back chain still runs so keypad back closes the layer.
    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("does not push a layer when the flag is off", () => {
    let controller: NavigationController | null = null;
    render(
      <FocusNavigationProvider enabled={false}>
        <Capture onController={(c) => (controller = c)} />
        <Dropdown open dismiss={vi.fn()} />
      </FocusNavigationProvider>,
    );
    expect(controller?.layerDepth).toBe(0);
  });
});

describe("FocusNavigationProvider — key-input diagnostics gating (GAP 4)", () => {
  afterEach(() => {
    saveDebugLoggingEnabled(false);
    clearLogs();
  });

  const keyInputEntries = () => getLogs().filter((entry) => entry.message === "key-input");

  it("debug logging OFF → no key-input entries reach addLog", () => {
    saveDebugLoggingEnabled(false);
    clearLogs();
    render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { code: "KeyQ", key: "q" });
    expect(keyInputEntries()).toHaveLength(0);
  });

  it("debug logging ON → recognized AND unmapped keys are logged (unknown not dropped)", () => {
    saveDebugLoggingEnabled(true);
    clearLogs();
    render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { code: "KeyQ", key: "q" });

    const details = keyInputEntries().map((entry) => entry.details as Record<string, unknown>);
    expect(details.some((d) => d.normalizedAction === "dpadDown" && d.handled === true)).toBe(true);
    expect(details.some((d) => d.normalizedAction === null && d.ignoredReason === "no-binding")).toBe(true);
  });
});
