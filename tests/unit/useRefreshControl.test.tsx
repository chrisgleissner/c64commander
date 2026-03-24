import { fireEvent, render, screen } from "@testing-library/react";
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
});
