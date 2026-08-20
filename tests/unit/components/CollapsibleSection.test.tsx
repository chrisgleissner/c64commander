import { forwardRef, useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Radio } from "lucide-react";

import { CollapsibleSection } from "@/components/CollapsibleSection";

vi.mock("framer-motion", () => ({
  motion: {
    // The real `motion.div` reports when its height animation settles, which is when the component
    // scrolls a freshly-expanded section into view. The stand-in reports it on mount, which is the
    // same moment for a non-animating test.
    div: ({ children, onAnimationComplete, ...props }: any) => {
      useEffect(() => {
        onAnimationComplete?.();
      }, [onAnimationComplete]);
      return <div {...props}>{children}</div>;
    },
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    // forwardRef, because the component takes a ref on the section to scroll it into view.
    section: forwardRef(({ children, ...props }: any, ref: any) => (
      <section ref={ref} {...props}>
        {children}
      </section>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("CollapsibleSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders closed by default and opens on tap", () => {
    render(
      <CollapsibleSection scope="test" id="audio" title="Audio" summary="Volume and mute per chip" icon={Radio}>
        <p>Channel strip</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(screen.queryByText("Channel strip")).not.toBeInTheDocument();
    expect(screen.getByTestId("test-section-audio")).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByTestId("test-section-toggle-audio"));

    expect(screen.getByText("Channel strip")).toBeInTheDocument();
    expect(screen.getByTestId("test-section-audio")).toHaveAttribute("data-open", "true");
  });

  it("hides the summary by default, and shows it once card descriptions are turned on", () => {
    // The description is the largest single consumer of vertical space on a page of closed cards:
    // a Settings card header measures 97 CSS px with it and roughly half that without, against the
    // 218 CSS px of scrollable height a 320x427 screen has.
    const { unmount } = render(
      <CollapsibleSection scope="test" id="audio" title="Audio" summary="Volume and mute per chip" icon={Radio}>
        <p>Channel strip</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("Volume and mute per chip")).not.toBeInTheDocument();
    unmount();

    localStorage.setItem("c64u_show_section_descriptions", "1");
    render(
      <CollapsibleSection scope="test" id="audio" title="Audio" summary="Volume and mute per chip" icon={Radio}>
        <p>Channel strip</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Volume and mute per chip")).toBeInTheDocument();
  });

  it("scrolls a freshly-expanded section into view without scrolling its header past the top", () => {
    // Opening a card near the bottom of the list used to leave its body below the fold, which is
    // worse now that one card is open at a time: the reader taps a title and sees nothing happen.
    // `block: "nearest"` scrolls the least amount that reveals the card, and aligns the TOP when
    // the card is taller than the scrollport — so the header of the section just opened stays put.
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    render(
      <CollapsibleSection scope="test" id="audio" title="Audio" icon={Radio}>
        <p>Channel strip</p>
      </CollapsibleSection>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("test-section-toggle-audio"));

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" }));
    scrollIntoView.mockClear();

    // Collapsing must not scroll: AnimatePresence reports the exit animation as complete too.
    fireEvent.click(screen.getByTestId("test-section-toggle-audio"));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("honors defaultOpen on a first visit to a fresh scope", () => {
    render(
      <CollapsibleSection scope="test" id="drives" title="Drives" icon={Radio} defaultOpen>
        <p>Drive A</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Drive A")).toBeInTheDocument();
    expect(screen.getByTestId("test-section-drives")).toHaveAttribute("data-open", "true");
  });

  it("remembers an open section across remounts, within its scope", () => {
    const { unmount } = render(
      <CollapsibleSection scope="test" id="ports" title="Ports" icon={Radio}>
        <p>Joystick</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByTestId("test-section-toggle-ports"));
    expect(screen.getByText("Joystick")).toBeInTheDocument();
    unmount();

    render(
      <CollapsibleSection scope="test" id="ports" title="Ports" icon={Radio}>
        <p>Joystick</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Joystick")).toBeInTheDocument();
  });

  it("keeps an untouched defaultOpen section open even after another section in the same scope is touched", () => {
    const first = render(
      <>
        <CollapsibleSection scope="test" id="quick-actions" title="Quick Actions" icon={Radio} defaultOpen>
          <p>Reset</p>
        </CollapsibleSection>
        <CollapsibleSection scope="test" id="printers" title="Printers" icon={Radio}>
          <p>Printer A</p>
        </CollapsibleSection>
      </>,
    );
    // Touch the closed-by-default section - this must not disturb quick-actions, which
    // was never itself toggled.
    fireEvent.click(screen.getByTestId("test-section-toggle-printers"));
    expect(screen.getByText("Printer A")).toBeInTheDocument();
    first.unmount();

    // Re-render fresh: quick-actions was never explicitly stored, so it must fall back
    // to its own defaultOpen regardless of what else in the scope has been stored.
    const { unmount } = render(
      <CollapsibleSection scope="test" id="quick-actions" title="Quick Actions" icon={Radio} defaultOpen>
        <p>Reset</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Reset")).toBeInTheDocument();
    expect(screen.getByTestId("test-section-quick-actions")).toHaveAttribute("data-open", "true");
    unmount();
  });

  it("remembers an explicitly closed defaultOpen section across remounts", () => {
    const first = render(
      <CollapsibleSection scope="test" id="quick-actions" title="Quick Actions" icon={Radio} defaultOpen>
        <p>Reset</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByTestId("test-section-toggle-quick-actions"));
    expect(screen.queryByText("Reset")).not.toBeInTheDocument();
    first.unmount();

    const { unmount } = render(
      <CollapsibleSection scope="test" id="quick-actions" title="Quick Actions" icon={Radio} defaultOpen>
        <p>Reset</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("Reset")).not.toBeInTheDocument();
    expect(screen.getByTestId("test-section-quick-actions")).toHaveAttribute("data-open", "false");
    unmount();
  });

  it("does not let two scopes sharing an id collide", () => {
    render(
      <>
        <CollapsibleSection scope="home" id="video" title="Home Video" icon={Radio}>
          <p>Home video content</p>
        </CollapsibleSection>
        <CollapsibleSection scope="settings" id="video" title="Settings Video" icon={Radio}>
          <p>Settings video content</p>
        </CollapsibleSection>
      </>,
    );

    fireEvent.click(screen.getByTestId("home-section-toggle-video"));

    expect(screen.getByText("Home video content")).toBeInTheDocument();
    expect(screen.queryByText("Settings video content")).not.toBeInTheDocument();
  });

  it("fires onToggle with the new state", () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleSection scope="test" id="streams" title="Streams" icon={Radio} onToggle={onToggle}>
        <p>Endpoints</p>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByTestId("test-section-toggle-streams"));
    expect(onToggle).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId("test-section-toggle-streams"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("supports custom testid overrides for pages with an established id scheme", () => {
    render(
      <CollapsibleSection
        scope="docs"
        id="getting-started"
        title="Getting started"
        icon={Radio}
        testId="docs-card-getting-started"
        toggleTestId="docs-toggle-getting-started"
        bodyId="docs-section-getting-started"
      >
        <p>Connect in 4 steps</p>
      </CollapsibleSection>,
    );

    expect(screen.getByTestId("docs-card-getting-started")).toBeInTheDocument();
    expect(screen.getByTestId("docs-toggle-getting-started")).toHaveAttribute(
      "aria-controls",
      "docs-section-getting-started",
    );

    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));

    expect(document.getElementById("docs-section-getting-started")).toBeInTheDocument();
  });

  it("defaults data-section-label to the title, and honors an explicit override", () => {
    const { rerender } = render(
      <CollapsibleSection scope="test" id="a" title="Case Light" icon={Radio}>
        <p>content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("test-section-a")).toHaveAttribute("data-section-label", "Case Light");

    rerender(
      <CollapsibleSection scope="test" id="a" title="Case Light" sectionLabel="LED Strip" icon={Radio}>
        <p>content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("test-section-a")).toHaveAttribute("data-section-label", "LED Strip");
  });

  it("renders actions beside the toggle, reachable while the section is closed", () => {
    const onReset = vi.fn();
    render(
      <CollapsibleSection
        scope="test"
        id="drives"
        title="Drives"
        icon={Radio}
        actions={
          <button type="button" data-testid="home-drives-reset" onClick={onReset}>
            Reset
          </button>
        }
      >
        <p>Drive A</p>
      </CollapsibleSection>,
    );

    expect(screen.getByTestId("test-section-drives")).toHaveAttribute("data-open", "false");
    fireEvent.click(screen.getByTestId("home-drives-reset"));
    expect(onReset).toHaveBeenCalledOnce();
    // The reset button is a sibling of the toggle, not nested inside it - clicking it
    // must not also toggle the section.
    expect(screen.getByTestId("test-section-drives")).toHaveAttribute("data-open", "false");
  });

  it("renders a badge beside the title without changing the heading's accessible name", () => {
    render(
      <CollapsibleSection scope="test" id="flags" title="Stable Features" icon={Radio} badge={<span>8/8 on</span>}>
        <p>content</p>
      </CollapsibleSection>,
    );

    expect(screen.getByRole("heading", { name: "Stable Features" })).toBeInTheDocument();
    expect(screen.getByText("8/8 on")).toBeInTheDocument();
  });
});
