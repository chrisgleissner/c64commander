import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createExternalOpenState, useExternalOpenState, useIsExternallyOpen } from "@/hooks/useExternalOpenState";

describe("createExternalOpenState", () => {
  it("notifies subscribers when the value changes and not when it is set to the same value", () => {
    const state = createExternalOpenState();
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);
    state.set(true);
    state.set(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(state.isOpen()).toBe(true);
    unsubscribe();
    state.set(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("useExternalOpenState", () => {
  it("re-renders only the component that reads the flag, not the one that owns the state", () => {
    let owner: ReturnType<typeof createExternalOpenState> | null = null;
    let ownerRenders = 0;
    const Reader = ({ state }: { state: ReturnType<typeof createExternalOpenState> }) => (
      <p>{useIsExternallyOpen(state) ? "open" : "closed"}</p>
    );
    const Owner = () => {
      ownerRenders += 1;
      owner = useExternalOpenState();
      return <Reader state={owner} />;
    };

    render(<Owner />);
    expect(screen.getByText("closed")).toBeInTheDocument();
    const rendersBefore = ownerRenders;

    act(() => owner!.set(true));

    expect(screen.getByText("open")).toBeInTheDocument();
    expect(ownerRenders).toBe(rendersBefore);
  });
});
