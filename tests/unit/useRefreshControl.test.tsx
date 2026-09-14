import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { RefreshControlProvider, useRefreshControl } from "@/hooks/useRefreshControl";

describe("useRefreshControl", () => {
  it("throws when used outside the provider", () => {
    const Consumer = () => {
      useRefreshControl();
      return null;
    };

    expect(() => render(<Consumer />)).toThrow(/must be used within RefreshControlProvider/);
  });

  it("tracks expanded config ids within the provider", () => {
    const Consumer = () => {
      const { configExpandedCount, setConfigExpanded } = useRefreshControl();
      return (
        <>
          <div data-testid="count">{configExpandedCount}</div>
          <button type="button" onClick={() => setConfigExpanded("audio-mixer", true)}>
            open
          </button>
          <button type="button" onClick={() => setConfigExpanded("audio-mixer", false)}>
            close
          </button>
        </>
      );
    };

    render(
      <RefreshControlProvider>
        <Consumer />
      </RefreshControlProvider>,
    );

    expect(screen.getByTestId("count").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("count").textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  // Config sections report their open state from an effect keyed on a callback the page recreates on
  // every render. When an unchanged report still published a new value, the page re-rendered, the effect
  // ran again, and the loop kept React busy enough to starve route transitions away from Config.
  it("does not re-render consumers when a section reports the state it is already in", () => {
    const MAX_REPORTS = 20;
    let reports = 0;
    let pageRenders = 0;

    const Section = ({ onOpenChange }: { onOpenChange: (isOpen: boolean) => void }) => {
      useEffect(() => {
        // Bounded so a regression fails the assertions below instead of hanging the test run.
        if (reports >= MAX_REPORTS) return;
        reports += 1;
        onOpenChange(false);
      }, [onOpenChange]);
      return null;
    };

    const Page = () => {
      const { setConfigExpanded } = useRefreshControl();
      pageRenders += 1;
      return <Section onOpenChange={(isOpen) => setConfigExpanded("Audio Mixer", isOpen)} />;
    };

    render(
      <RefreshControlProvider>
        <Page />
      </RefreshControlProvider>,
    );

    expect(reports).toBe(1);
    expect(pageRenders).toBe(1);
  });
});
