/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FocusNavigationProvider,
  useDismissibleNavigationLayer,
  useFocusItem,
  useFocusNavigation,
} from "@/hooks/useFocusNavigation";
import { NavigationController, resetInputModality, setInputModality } from "@/lib/input";
import { saveDebugLoggingEnabled } from "@/lib/config/appSettings";
import { clearLogs, getLogs } from "@/lib/logging";
import { Checkbox } from "@/components/ui/checkbox";

const SELECTED = "data-key-selected";

/**
 * Resolve the real interactive control by accessible role + name. The provider
 * renders an aria-hidden {@link import("@/components/input/KeypadGuidanceBar")}
 * whose breadcrumb mirrors the focused control's label as plain text, so a raw
 * `getByText("B")` matches both the button and that decorative mirror. Querying by
 * `button` role excludes the mirror (it is `<span>`/`<div>`/`<kbd>`, never a
 * button) while asserting the exact same focus/activation behaviour.
 */
const button = (name: string) => screen.getByRole("button", { name });
const queryButton = (name: string) => screen.queryByRole("button", { name });

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
    render(
      <FocusNavigationProvider>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("B"));

    // Forward from B wraps past the disabled C back to A.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("A"));

    // Backward from A also skips the disabled C and lands on B.
    fireEvent.keyDown(document.body, { code: "ArrowUp" });
    expect(document.activeElement).toBe(button("B"));

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
    render(
      <FocusNavigationProvider>
        <InDialog />
      </FocusNavigationProvider>,
    );

    // Enter on a CTA inside the dialog must reach the overlay, not the global ring.
    fireEvent.keyDown(button("X"), { code: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("defers Enter to a focused native button that is not the ring's current item", () => {
    const onActivateRing = vi.fn();
    const Layout = () => {
      const ringRef = useFocusItem<HTMLButtonElement>({ id: "ring", order: 0, onActivate: onActivateRing });
      return (
        <>
          <button ref={ringRef}>Ring</button>
          <button data-testid="native">Native</button>
        </>
      );
    };
    const { getByTestId } = render(
      <FocusNavigationProvider>
        <Layout />
      </FocusNavigationProvider>,
    );

    // Tab / programmatic focus put DOM focus on a button outside the ring; the
    // browser owns its Enter activation, so the ring's current item must not fire.
    const nativeButton = getByTestId("native");
    nativeButton.focus();
    fireEvent.keyDown(nativeButton, { code: "Enter" });
    expect(onActivateRing).not.toHaveBeenCalled();
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
    // The field keeps its typing and caret keys (default not prevented) and focus stays.
    expect(fireEvent.keyDown(input, { code: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    expect(document.activeElement).toBe(input);

    const note = getByLabelText("note") as HTMLDivElement;
    note.focus();
    expect(fireEvent.keyDown(note, { code: "ArrowDown" })).toBe(true);
    expect(document.activeElement).toBe(note);
  });

  it("moves the ring on when Down is pressed in a single-line field on a page", () => {
    const FieldThenButton = () => {
      const fieldRef = useFocusItem<HTMLInputElement>({ id: "field", order: 10 });
      const nextRef = useFocusItem<HTMLButtonElement>({ id: "next", order: 20 });
      return (
        <>
          <input ref={fieldRef} aria-label="Search categories" />
          <button ref={nextRef} onClick={() => {}}>
            Next
          </button>
        </>
      );
    };
    const { getByLabelText } = render(
      <FocusNavigationProvider>
        <FieldThenButton />
      </FocusNavigationProvider>,
    );
    const field = getByLabelText("Search categories") as HTMLInputElement;
    // The ring starts on the field; OK is the explicit "go in" that focuses it for typing.
    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(document.activeElement).toBe(field);

    expect(fireEvent.keyDown(field, { code: "ArrowDown" })).toBe(false);

    expect(document.activeElement).toBe(button("Next"));
    expect(button("Next").getAttribute(SELECTED)).toBe("true");
  });

  it("leaves a single-line field on a page on OK, after the field has handled its own Enter", () => {
    const committed: string[] = [];
    const FieldThenButton = () => {
      const fieldRef = useFocusItem<HTMLInputElement>({ id: "field", order: 10 });
      const nextRef = useFocusItem<HTMLButtonElement>({ id: "next", order: 20 });
      return (
        <>
          <input
            ref={fieldRef}
            aria-label="Probe timeout"
            onKeyDown={(event) => {
              if (event.key === "Enter") committed.push(event.currentTarget.value);
            }}
          />
          <button ref={nextRef} onClick={() => {}}>
            Next
          </button>
        </>
      );
    };
    const { getByLabelText } = render(
      <FocusNavigationProvider>
        <FieldThenButton />
      </FocusNavigationProvider>,
    );
    const field = getByLabelText("Probe timeout") as HTMLInputElement;
    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(document.activeElement).toBe(field);
    field.value = "900";

    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });

    expect(committed).toEqual(["900"]);
    expect(document.activeElement).not.toBe(field);
    expect(field.getAttribute(SELECTED)).toBe("true");
  });

  it("continues from a field the user tapped into when Down leaves it", () => {
    const FieldBetweenButtons = () => {
      const beforeRef = useFocusItem<HTMLButtonElement>({ id: "before", order: 10 });
      const fieldRef = useFocusItem<HTMLInputElement>({ id: "field", order: 20 });
      const afterRef = useFocusItem<HTMLButtonElement>({ id: "after", order: 30 });
      return (
        <>
          <button ref={beforeRef} onClick={() => {}}>
            Before
          </button>
          <input ref={fieldRef} aria-label="Search categories" />
          <button ref={afterRef} onClick={() => {}}>
            After
          </button>
        </>
      );
    };
    const { getByLabelText } = render(
      <FocusNavigationProvider>
        <FieldBetweenButtons />
      </FocusNavigationProvider>,
    );
    setInputModality("pointer");
    const field = getByLabelText("Search categories") as HTMLInputElement;
    field.focus();

    fireEvent.keyDown(field, { code: "ArrowDown" });

    expect(button("After").getAttribute(SELECTED)).toBe("true");
  });

  /*
   * Escape and the device's Back key have to be able to leave a field, and where they leave it to
   * matters: a bare blur put DOM focus on the body, which is nowhere for a keypad user. When the
   * ring has a stop it goes back to it; with nothing selected there is nothing to go back to, and
   * blurring is all that is left.
   */
  it("blurs a field on Escape when the ring has no stop to go back to", () => {
    const LoneField = () => <input aria-label="host" />;
    const { getByLabelText } = render(
      <FocusNavigationProvider>
        <LoneField />
      </FocusNavigationProvider>,
    );

    const input = getByLabelText("host") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape", code: "", keyCode: 0 });

    expect(document.activeElement).not.toBe(input);
  });

  it("leaves Back in a field inside an open dialog to the dialog", () => {
    const { getByLabelText } = render(
      <FocusNavigationProvider>
        <div role="dialog">
          <input aria-label="Password" />
        </div>
      </FocusNavigationProvider>,
    );
    const input = getByLabelText("Password") as HTMLInputElement;
    input.focus();

    expect(fireEvent.keyDown(input, { key: "Escape", code: "", keyCode: 0 })).toBe(true);
    expect(document.activeElement).toBe(input);
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
    // ArrowLeft → dpadLeft is a sibling move when nothing owns horizontal → consumed.
    expect(fireEvent.keyDown(document.body, { code: "ArrowLeft" })).toBe(false);
    // A digit is owned by the T9 composer / field, not the ring → not prevented.
    expect(fireEvent.keyDown(document.body, { code: "Digit5" })).toBe(true);
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
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toolbar onA={vi.fn()} onB={onB} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(button("B"));
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

    const { rerender } = render(
      <FocusNavigationProvider>
        <Switchable show />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("B"));

    rerender(
      <FocusNavigationProvider>
        <Switchable show={false} />
      </FocusNavigationProvider>,
    );
    expect(queryButton("B")).toBeNull();

    // With B gone the only enabled item is A, so forward navigation stays on A.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("A"));
  });

  it("navigates nested CTA groups with OK to descend and Back/Escape to climb (new model)", () => {
    render(
      <FocusNavigationProvider>
        <NestedToolbar />
      </FocusNavigationProvider>,
    );

    // OK on the card (a group with children) descends to its first child.
    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(document.activeElement).toBe(button("Primary"));
    expect(button("Primary")).toHaveAttribute(SELECTED, "true");

    // Up/Down move among the descended children.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("Secondary"));
    expect(button("Secondary")).toHaveAttribute(SELECTED, "true");

    // Escape ascends back to the card (but never navigates the route).
    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(document.activeElement).toBe(button("Card"));
    expect(button("Card")).toHaveAttribute(SELECTED, "true");

    // Re-descend with OK; Escape climbs out again.
    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(document.activeElement).toBe(button("Primary"));
    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(document.activeElement).toBe(button("Card"));

    // At the top level, Down moves to the card's sibling.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("After"));
  });

  /*
   * The device's own Back key carries no key code, so it matches none of the keymap's back
   * bindings and used to fall through the "no binding" return without ascending. On the handset
   * that meant a user who pressed OK into a card could not get out of it again: the rest of the
   * page stayed out of reach until they left the route with a digit.
   */
  it("climbs out of a card on the device's own Back key, which matches no keymap binding", () => {
    render(
      <FocusNavigationProvider>
        <NestedToolbar />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(document.activeElement).toBe(button("Primary"));

    fireEvent.keyDown(document.body, { key: "Escape", code: "", keyCode: 0 });

    expect(document.activeElement).toBe(button("Card"));
    expect(button("Card")).toHaveAttribute(SELECTED, "true");
  });

  it("leaves the route on the device's own Back key once nothing on the page is left to close", () => {
    const onNavigateBack = vi.fn();
    render(
      <FocusNavigationProvider onNavigateBack={onNavigateBack}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "Escape", code: "", keyCode: 0 });

    expect(onNavigateBack).toHaveBeenCalledTimes(1);
  });

  it("leaves the device's own Back key to an open dialog instead of leaving the route", () => {
    const onNavigateBack = vi.fn();
    render(
      <FocusNavigationProvider onNavigateBack={onNavigateBack}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
        <div role="dialog" aria-label="Settings" />
      </FocusNavigationProvider>,
    );

    const event = fireEvent.keyDown(document.body, { key: "Escape", code: "", keyCode: 0 });

    expect(onNavigateBack).not.toHaveBeenCalled();
    expect(event).toBe(true);
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
    render(<Lonely />);

    expect(button("Lonely")).toBeInTheDocument();
    // No provider → no global listener → key press changes nothing and does not throw.
    expect(fireEvent.keyDown(document.body, { code: "ArrowDown" })).toBe(true);
  });
});

describe("FocusNavigationProvider — modality + selected-control highlight (Prime Directive)", () => {
  it("flag OFF: a key never sets data-key-selected (byte-for-byte baseline)", () => {
    render(
      <FocusNavigationProvider enabled={false}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(button("A")).not.toHaveAttribute(SELECTED);
    expect(button("B")).not.toHaveAttribute(SELECTED);
  });

  it("flag ON: no highlight before a key; highlight on the focused item after a recognized key", () => {
    render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    // State 2: flag on, pre-key → still no affordance.
    expect(button("A")).not.toHaveAttribute(SELECTED);
    expect(button("B")).not.toHaveAttribute(SELECTED);

    // State 3: a recognized nav key → modality key-navigation → highlight on B.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(button("B")).toHaveAttribute(SELECTED, "true");
    expect(button("A")).not.toHaveAttribute(SELECTED);
  });

  it("an unrecognized / ignored key does not flip modality or set the highlight", () => {
    render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    // Digit5 → owned by the T9/field layer, ignored by the ring; KeyQ → no binding.
    fireEvent.keyDown(document.body, { code: "Digit5" });
    fireEvent.keyDown(document.body, { code: "KeyQ", key: "q" });
    expect(button("A")).not.toHaveAttribute(SELECTED);
    expect(button("B")).not.toHaveAttribute(SELECTED);
  });

  it("the highlight moves to the new item on each focus change", () => {
    render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" }); // → B
    expect(button("B")).toHaveAttribute(SELECTED, "true");
    fireEvent.keyDown(document.body, { code: "ArrowDown" }); // wraps → A
    expect(button("A")).toHaveAttribute(SELECTED, "true");
    expect(button("B")).not.toHaveAttribute(SELECTED);
  });

  it("State 4: a pointer/touch interaction clears the highlight the same frame", () => {
    render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(button("B")).toHaveAttribute(SELECTED, "true");

    fireEvent.pointerDown(document.body);
    expect(button("B")).not.toHaveAttribute(SELECTED);
  });

  it("clears the highlight when the flag is turned off", () => {
    const { rerender } = render(
      <FocusNavigationProvider enabled>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(button("B")).toHaveAttribute(SELECTED, "true");

    rerender(
      <FocusNavigationProvider enabled={false}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    expect(button("B")).not.toHaveAttribute(SELECTED);
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
    const { rerender } = render(tree(false));
    expect(controller?.layerDepth).toBe(0);

    rerender(tree(true));
    expect(controller?.layerDepth).toBe(1);

    // With the layer open the underlying ring must not move on Down (HAZARD 2).
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(document.activeElement).not.toBe(button("B"));

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

describe("FocusNavigationProvider global shortcuts", () => {
  it("fires tab-jump (1–6), Diagnostics (*), and Device Switcher (#) outside text fields", () => {
    const jumpToTab = vi.fn();
    const openDiagnostics = vi.fn();
    const openDeviceSwitcher = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ jumpToTab, openDiagnostics, openDeviceSwitcher }}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "Digit3" });
    expect(jumpToTab).toHaveBeenCalledWith(2); // 0-based tab index

    fireEvent.keyDown(document.body, { key: "*" });
    expect(openDiagnostics).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: "#" });
    expect(openDeviceSwitcher).toHaveBeenCalledTimes(1);
  });

  it("lands on the page's first control after a tab jump made while the ring was on the tab bar", async () => {
    const jumpToTab = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ jumpToTab }}>
        <button type="button">Page first</button>
        <button type="button">Page second</button>
        <nav data-focus-scope="tabbar">
          <button type="button">Play tab</button>
        </nav>
      </FocusNavigationProvider>,
    );
    setInputModality("key-navigation");
    button("Play tab").focus();
    await waitFor(() => expect(button("Play tab").getAttribute(SELECTED)).toBe("true"));

    fireEvent.keyDown(document.body, { code: "Digit4" });

    expect(jumpToTab).toHaveBeenCalledWith(3);
    await waitFor(() => expect(button("Page first").getAttribute(SELECTED)).toBe("true"));
    resetInputModality();
  });

  /*
   * 8 and 9 exist because the same two actions cost ten and eight presses through Home's Quick
   * Actions grid from a cold arrival, measured on the handset. The grid is not moving; these are a
   * shorter way to it. 7 is search and 0 is Game Mode, so these were the digits going spare.
   */
  it("fires the machine controls on 8 and 9", () => {
    const machinePauseResume = vi.fn();
    const machineReset = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ machinePauseResume, machineReset }}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "Digit8" });
    expect(machinePauseResume).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { code: "Digit9" });
    expect(machineReset).toHaveBeenCalledTimes(1);
  });

  it("leaves the machine keys to T9 while editing a text field", () => {
    const machinePauseResume = vi.fn();
    const machineReset = vi.fn();
    const { getByLabelText } = render(
      <FocusNavigationProvider shortcuts={{ machinePauseResume, machineReset }}>
        <input aria-label="host" />
      </FocusNavigationProvider>,
    );

    const input = getByLabelText("host") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { code: "Digit8" });
    fireEvent.keyDown(input, { code: "Digit9" });

    expect(machinePauseResume).not.toHaveBeenCalled();
    expect(machineReset).not.toHaveBeenCalled();
  });

  it("leaves digits/star/hash to T9 while editing a text field (no shortcut hijack)", () => {
    const jumpToTab = vi.fn();
    const openDiagnostics = vi.fn();
    const openDeviceSwitcher = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ jumpToTab, openDiagnostics, openDeviceSwitcher }}>
        <input aria-label="host" />
      </FocusNavigationProvider>,
    );
    const input = screen.getByLabelText("host");
    input.focus();

    fireEvent.keyDown(input, { code: "Digit3" });
    fireEvent.keyDown(input, { key: "*" });
    fireEvent.keyDown(input, { key: "#" });

    expect(jumpToTab).not.toHaveBeenCalled();
    expect(openDiagnostics).not.toHaveBeenCalled();
    expect(openDeviceSwitcher).not.toHaveBeenCalled();
  });

  // GM-17: from anywhere in the app, with a game already running, one keystroke.
  it("enters Game Mode from 0 outside text fields", () => {
    const openGameMode = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ openGameMode }}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "Digit0" });
    expect(openGameMode).toHaveBeenCalledTimes(1);
  });

  it("leaves 0 to T9 while a text field holds the ring", () => {
    const openGameMode = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ openGameMode }}>
        <input aria-label="host" />
      </FocusNavigationProvider>,
    );
    const input = screen.getByLabelText("host");
    input.focus();

    fireEvent.keyDown(input, { code: "Digit0" });
    expect(openGameMode).not.toHaveBeenCalled();
  });

  // Inside the Remote Input sheet `0` is a joystick direction, and the sheet is an
  // open overlay — so this handler must never see the key at all.
  it("never reaches the joystick relay: 0 inside an open overlay does nothing", () => {
    const openGameMode = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ openGameMode }}>
        <div role="dialog" data-state="open">
          <button type="button" aria-label="in sheet" />
        </div>
      </FocusNavigationProvider>,
    );
    const inSheet = screen.getByLabelText("in sheet");
    inSheet.focus();

    fireEvent.keyDown(inSheet, { code: "Digit0" });
    expect(openGameMode).not.toHaveBeenCalled();
  });

  it("does nothing when no Game Mode handler is wired (feature flag off)", () => {
    render(
      <FocusNavigationProvider shortcuts={{}}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    expect(() => fireEvent.keyDown(document.body, { code: "Digit0" })).not.toThrow();
  });

  it("opens the quick menu from the Menu key when the focused item has no context menu", () => {
    const openQuickMenu = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ openQuickMenu }}>
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ContextMenu" });
    expect(openQuickMenu).toHaveBeenCalledTimes(1);
  });

  it("opens the focused item's own menu from the Menu key rather than the quick menu", () => {
    const openQuickMenu = vi.fn();
    const openRowActions = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ openQuickMenu }}>
        <button type="button" aria-haspopup="menu" onClick={openRowActions}>
          Item actions
        </button>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ContextMenu" });

    expect(openRowActions).toHaveBeenCalledTimes(1);
    expect(openQuickMenu).not.toHaveBeenCalled();
  });

  it("opens the quick menu from the Menu key on a page with nothing to select", () => {
    const openQuickMenu = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ openQuickMenu }}>
        <p>Nothing here</p>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ContextMenu" });

    expect(openQuickMenu).toHaveBeenCalledTimes(1);
  });

  it("opens the quick menu from the Menu key on a card, not the first row's actions inside it", () => {
    const openQuickMenu = vi.fn();
    const openRowActions = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ openQuickMenu }}>
        <section data-section-label="Playlist">
          <button type="button">Tune one</button>
          <button type="button" aria-haspopup="menu" onClick={openRowActions}>
            Item actions
          </button>
        </section>
        <button type="button">After</button>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ContextMenu" });

    expect(openRowActions).not.toHaveBeenCalled();
    expect(openQuickMenu).toHaveBeenCalledTimes(1);
  });
});

/**
 * A focused single-line text field used to swallow every navigation key. Outside an
 * overlay that is survivable — Back/Escape blur the field — but inside a dialog those
 * belong to the overlay and close it, and the global ring is deliberately inert there.
 * So a keypad user whose focus landed in a dialog's text field could reach nothing else
 * in that dialog, including its own primary action. Found on a 427x320 handset, where
 * the discovery dialog's Connect button became unreachable:
 * docs/testing/agentic-tests/full-cta-coverage/defects/S2-GAMEMODE-8020-LANDSCAPE-CONNECT-UNREACHABLE.md
 */
describe("vertical keys escape a single-line field inside an overlay", () => {
  const Dialog = () => (
    <FocusNavigationProvider>
      <div role="dialog" aria-label="Connect to a device">
        <input data-testid="host" aria-label="Host or IP" defaultValue="" />
        <button type="button">Connect</button>
        <button type="button">Not now</button>
      </div>
    </FocusNavigationProvider>
  );

  it("moves focus off the field on Down instead of trapping the keypad", () => {
    render(<Dialog />);
    const host = screen.getByLabelText("Host or IP");
    host.focus();
    expect(document.activeElement).toBe(host);

    fireEvent.keyDown(host, { code: "ArrowDown" });

    expect(document.activeElement).toBe(button("Connect"));
  });

  it("moves back to the field on Up", () => {
    render(<Dialog />);
    const host = screen.getByLabelText("Host or IP");
    host.focus();

    fireEvent.keyDown(host, { code: "ArrowUp" });

    expect(document.activeElement).toBe(button("Not now"));
  });

  it("moves focus off a number field on Down, whose own Up/Down would otherwise trap the keypad", () => {
    render(
      <FocusNavigationProvider>
        <div role="dialog" aria-label="Lighting Studio">
          <input type="number" aria-label="Red" defaultValue="10" />
          <button type="button">Apply</button>
        </div>
      </FocusNavigationProvider>,
    );
    const red = screen.getByLabelText("Red");
    red.focus();

    fireEvent.keyDown(red, { code: "ArrowDown" });

    expect(document.activeElement).toBe(button("Apply"));
  });

  it("leaves a textarea alone, where Up and Down move the caret", () => {
    render(
      <FocusNavigationProvider>
        <div role="dialog" aria-label="Notes">
          <textarea aria-label="Notes field" />
          <button type="button">Save</button>
        </div>
      </FocusNavigationProvider>,
    );
    const notes = screen.getByLabelText("Notes field");
    notes.focus();

    fireEvent.keyDown(notes, { code: "ArrowDown" });

    expect(document.activeElement).toBe(notes);
  });
});

/**
 * A plain Radix dialog is "inert" to the global ring by design (HAZARD 2) — the overlay
 * owns the keyboard. Radix answers that with its own Tab focus trap, but a keypad handset
 * has no Tab key, only Up/Down. Before this fix, Up/Down on a non-field target inside an
 * overlay hit the same `isWithinOpenOverlay` bail as everything else, so a dialog whose
 * first focus lands on its own non-tabbable content wrapper — every plain Radix
 * DialogContent, before any field or button takes focus — was a dead end: nothing but
 * Back/Escape could be reached. Demo Mode's "Continue in Demo Mode" button was exactly
 * this case on a keypad-only handset profile.
 */
describe("vertical keys walk a dialog's own tab order for non-field targets", () => {
  const Dialog = () => (
    <FocusNavigationProvider>
      <div role="dialog" aria-label="Demo Mode">
        <button type="button">Close</button>
        <button type="button">Retry connection</button>
        <button type="button">Continue in Demo Mode</button>
      </div>
    </FocusNavigationProvider>
  );

  it("reaches the first control on Down when nothing in the dialog is focused yet", () => {
    render(<Dialog />);
    // Radix autofocuses the dialog's content wrapper on open, not a real control — so the
    // keydown target is the dialog itself, not one of its buttons.
    fireEvent.keyDown(screen.getByRole("dialog"), { code: "ArrowDown" });

    expect(document.activeElement).toBe(button("Close"));
  });

  it("goes into the dialog on OK while the dialog itself holds focus", () => {
    render(<Dialog />);
    const dialog = screen.getByRole("dialog");
    dialog.tabIndex = -1;
    dialog.focus();

    fireEvent.keyDown(dialog, { key: "Enter", code: "Enter" });

    expect(document.activeElement).toBe(button("Close"));
  });

  it("reaches the last control on Up when nothing in the dialog is focused yet", () => {
    render(<Dialog />);
    fireEvent.keyDown(screen.getByRole("dialog"), { code: "ArrowUp" });

    expect(document.activeElement).toBe(button("Continue in Demo Mode"));
  });

  it("cycles forward through every control and wraps", () => {
    render(<Dialog />);
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("Close"));

    fireEvent.keyDown(button("Close"), { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("Retry connection"));

    fireEvent.keyDown(button("Retry connection"), { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("Continue in Demo Mode"));

    fireEvent.keyDown(button("Continue in Demo Mode"), { code: "ArrowDown" });
    expect(document.activeElement).toBe(button("Close"));
  });

  it("draws the steady keypad highlight on the dialog control that Down moved to", () => {
    // The dialog's content is a ring group of its own, as a sheet or modal surface is.
    render(
      <FocusNavigationProvider>
        <div role="dialog" aria-label="Demo Mode">
          <div data-section-label="Demo Mode">
            <button type="button">Close</button>
            <button type="button">Retry connection</button>
            <button type="button">Continue in Demo Mode</button>
          </div>
        </div>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { code: "ArrowDown" });
    fireEvent.keyDown(button("Close"), { code: "ArrowDown" });

    expect(button("Retry connection").getAttribute(SELECTED)).toBe("true");
    expect(document.querySelectorAll(`[${SELECTED}="true"]`)).toHaveLength(1);
  });
});

describe("the keypad highlight follows focus that a menu moves itself", () => {
  afterEach(() => resetInputModality());

  it("highlights and reveals the menu item that received focus", () => {
    render(
      <FocusNavigationProvider>
        <div role="menu" aria-label="Item actions">
          <div role="menuitem" tabIndex={-1}>
            Review playback config
          </div>
          <div role="menuitem" tabIndex={-1}>
            Remove
          </div>
        </div>
      </FocusNavigationProvider>,
    );
    setInputModality("key-navigation");
    const remove = screen.getByRole("menuitem", { name: "Remove" });
    const scrollIntoView = vi.fn();
    remove.scrollIntoView = scrollIntoView;

    remove.focus();

    expect(remove.getAttribute(SELECTED)).toBe("true");
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("the keypad highlight follows focus moved to a control the ring has not scanned yet", () => {
  afterEach(() => resetInputModality());

  it("highlights a control that received focus in the same task that added it", async () => {
    render(
      <FocusNavigationProvider>
        <div role="dialog" aria-label="From C64U" data-section-label="From C64U">
          <button type="button">Close</button>
          <div data-testid="entries">
            <button type="button">Open Demos</button>
          </div>
        </div>
      </FocusNavigationProvider>,
    );
    setInputModality("key-navigation");
    button("Open Demos").focus();
    await waitFor(() => expect(button("Open Demos").getAttribute(SELECTED)).toBe("true"));

    // A folder view replaces its entries and focuses the first one before the ring rescans.
    const entries = screen.getByTestId("entries");
    const firstEntry = document.createElement("button");
    firstEntry.type = "button";
    firstEntry.textContent = "Open Collection";
    entries.replaceChildren(firstEntry);
    firstEntry.focus();

    await waitFor(() => expect(firstEntry.getAttribute(SELECTED)).toBe("true"));
  });
});

describe("the keypad highlight follows focus handed back to a menu trigger", () => {
  afterEach(() => resetInputModality());

  it("moves the ring onto the trigger a closing menu returns focus to", () => {
    const onActions = vi.fn();
    render(
      <FocusNavigationProvider>
        <button type="button">Card action</button>
        <button type="button" aria-haspopup="menu" onClick={onActions}>
          Item actions
        </button>
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { code: "ArrowUp" });
    expect(button("Card action").getAttribute(SELECTED)).toBe("true");

    button("Item actions").focus();

    expect(button("Item actions").getAttribute(SELECTED)).toBe("true");
    expect(button("Card action").getAttribute(SELECTED)).toBeNull();
  });

  it("goes into a card on the second OK after the first OK opened it", async () => {
    const Card = () => {
      const [open, setOpen] = useState(false);
      return (
        <section data-section-label="Memory">
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            Memory
          </button>
          {open ? <button type="button">Kernal ROM</button> : null}
        </section>
      );
    };
    render(
      <FocusNavigationProvider>
        <Card />
        <button type="button">Next section</button>
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { code: "ArrowUp" });

    fireEvent.keyDown(document.activeElement ?? document.body, { code: "Enter" });
    await waitFor(() => expect(button("Kernal ROM")).toBeInTheDocument());
    fireEvent.keyDown(document.activeElement ?? document.body, { code: "Enter" });

    await waitFor(() => expect(button("Memory").getAttribute(SELECTED)).toBe("true"));
    expect(button("Memory")).toHaveAttribute("aria-expanded", "true");
  });

  it("stays on a single-control card after OK activates that control, so Down moves on", () => {
    const onToggle = vi.fn();
    render(
      <FocusNavigationProvider>
        <section data-section-label="Appearance">
          <button type="button" onClick={onToggle}>
            Appearance
          </button>
        </section>
        <button type="button">Next section</button>
      </FocusNavigationProvider>,
    );
    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { code: "ArrowUp" });

    fireEvent.keyDown(document.body, { code: "Enter" });
    fireEvent.keyDown(document.body, { code: "ArrowDown" });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(button("Next section").getAttribute(SELECTED)).toBe("true");
  });
});

describe("OK toggles a checkbox inside a dialog", () => {
  it("checks a focused checkbox on Enter, which the checkbox itself ignores", () => {
    const onCheckedChange = vi.fn();
    render(
      <FocusNavigationProvider>
        <div role="dialog" aria-label="Add items">
          <Checkbox aria-label="Select Usb0" onCheckedChange={onCheckedChange} />
        </div>
      </FocusNavigationProvider>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Select Usb0" });
    checkbox.focus();

    fireEvent.keyDown(checkbox, { key: "Enter", code: "", keyCode: 13 });

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("the first-run tour owns the keys", () => {
  afterEach(() => document.documentElement.removeAttribute("data-tour-active"));

  it("does not activate the ring's item on OK while the tour is up", () => {
    const onA = vi.fn();
    render(
      <FocusNavigationProvider>
        <Toolbar onA={onA} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    document.documentElement.setAttribute("data-tour-active", "true");

    fireEvent.keyDown(document.body, { code: "Enter" });

    expect(onA).not.toHaveBeenCalled();
  });
});

describe("one-shot keypad commands ignore key repeat", () => {
  it("pauses once for a held 8, not once per repeat", () => {
    const machinePauseResume = vi.fn();
    render(
      <FocusNavigationProvider shortcuts={{ machinePauseResume }}>
        <button type="button">A</button>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { key: "8", code: "", keyCode: 56 });
    fireEvent.keyDown(document.body, { key: "8", code: "", keyCode: 56, repeat: true });
    fireEvent.keyDown(document.body, { key: "8", code: "", keyCode: 56, repeat: true });

    expect(machinePauseResume).toHaveBeenCalledTimes(1);
  });

  it("clicks the selected control once for a held Call key, not once per repeat", () => {
    const onA = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toolbar onA={onA} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { key: "Call", code: "Call" });
    fireEvent.keyDown(document.body, { key: "Call", code: "Call", repeat: true });
    fireEvent.keyDown(document.body, { key: "Call", code: "Call", repeat: true });

    expect(onA).toHaveBeenCalledTimes(1);
  });
});

/*
 * Destructive toasts persist until dismissed (ERROR_POLICY §4), render in their own portal
 * outside the keypad ring's reach, and have no Tab-reachable close button — only a touch
 * swipe/tap dismisses one (`components/ui/toaster.tsx` `ToastItem.handleClick`). On a Pixel 4
 * emulating a keypad-only profile, an error toast survived 19 minutes of further navigation
 * because no key, Back included, could reach it.
 */
describe("Back dismisses a persistent error toast the keypad ring cannot otherwise reach", () => {
  const Toast = ({ onDismiss }: { onDismiss: () => void }) => (
    <li data-testid="app-toast" tabIndex={0} onClick={onDismiss}>
      Playback next failed
    </li>
  );

  it("clicks the toast (dismiss + open Diagnostics, same as a tap) on Back", () => {
    const onDismiss = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toast onDismiss={onDismiss} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "GoBack" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("also dismisses on the device's own physical Back key ({key:'Escape',code:'',keyCode:0} — none of the keymap's declared back bindings match that on their own)", () => {
    const onDismiss = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toast onDismiss={onDismiss} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { key: "Escape", code: "", keyCode: 0 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("leaves a real external keyboard's Escape key alone (a proper code:'Escape' is not the device's quirked signature)", () => {
    const onDismiss = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toast onDismiss={onDismiss} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape", keyCode: 27 });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("defers to an open dialog instead — the dialog is what the user is actively closing", () => {
    const onDismiss = vi.fn();
    const onNavigateBack = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad" onNavigateBack={onNavigateBack}>
        <Toast onDismiss={onDismiss} />
        <div role="dialog" aria-label="Settings" />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "GoBack" });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("falls through to normal Back handling when no toast is showing", () => {
    const onNavigateBack = vi.fn();
    render(<FocusNavigationProvider profileId="keypad" onNavigateBack={onNavigateBack} />);

    fireEvent.keyDown(document.body, { code: "GoBack" });

    expect(onNavigateBack).toHaveBeenCalledTimes(1);
  });
});

/*
 * HARD27-039: with the keypad flag on - the default for the C64 Commander
 * variant - the discovery engine used to observe the whole body from mount, so
 * a touch user scrolling a virtualised list rebuilt the ring on the main thread
 * for a modality they never entered. It now waits for the first key.
 */
describe("FocusNavigationProvider — the discovery engine waits for a key (HARD27-039)", () => {
  let observedTargets: Node[] = [];
  let realMutationObserver: typeof MutationObserver;

  beforeEach(() => {
    resetInputModality();
    observedTargets = [];
    realMutationObserver = globalThis.MutationObserver;
    class RecordingMutationObserver extends realMutationObserver {
      observe(target: Node, options?: MutationObserverInit) {
        observedTargets.push(target);
        super.observe(target, options);
      }
    }
    globalThis.MutationObserver = RecordingMutationObserver as typeof MutationObserver;
  });

  afterEach(() => {
    globalThis.MutationObserver = realMutationObserver;
    resetInputModality();
  });

  it("attaches no observer while the user has only ever used the pointer", () => {
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    expect(observedTargets).toEqual([]);
    expect(button("A")).not.toHaveAttribute(SELECTED);
  });

  it("starts on the first navigation key, and that first key still moves the ring", () => {
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });

    // The ring assembles with A current, so Down lands on B - the same place
    // the eagerly started engine put it. The first key is not swallowed.
    expect(observedTargets).toEqual([document.body]);
    expect(document.activeElement).toBe(button("B"));
    expect(button("B")).toHaveAttribute(SELECTED, "true");
  });

  it("starts when another surface flips modality without going through the keymap", () => {
    render(
      <FocusNavigationProvider profileId="keypad">
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );
    expect(observedTargets).toEqual([]);

    // A slider or the T9 composer flips modality from its own handler.
    setInputModality("key-navigation");

    expect(observedTargets).toEqual([document.body]);
  });

  it("starts on mount when a key user has already been navigating", () => {
    setInputModality("key-navigation");

    render(
      <FocusNavigationProvider profileId="keypad">
        <Toolbar onA={vi.fn()} onB={vi.fn()} />
      </FocusNavigationProvider>,
    );

    expect(observedTargets).toEqual([document.body]);
  });
});
