import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DisplayProfileProvider, useDisplayProfile, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const Consumer = () => {
  const { profile, autoProfile, override } = useDisplayProfile();
  const { setOverride } = useDisplayProfilePreference();
  return (
    <div>
      <div data-testid="profile">{profile}</div>
      <div data-testid="auto-profile">{autoProfile}</div>
      <div data-testid="override">{override}</div>
      <button type="button" onClick={() => setOverride("expanded")}>
        Force expanded
      </button>
    </div>
  );
};

describe("DisplayProfileProvider", () => {
  it("tracks automatic viewport changes and persists manual overrides", () => {
    localStorage.clear();
    setViewportWidth(320);

    render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("auto-profile")).toHaveTextContent("compact");
    expect(screen.getByTestId("profile")).toHaveTextContent("compact");
    expect(document.documentElement.dataset.displayProfile).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--display-profile-root-font-size")).toBe("16px");

    fireEvent.click(screen.getByRole("button", { name: "Force expanded" }));

    expect(screen.getByTestId("override")).toHaveTextContent("expanded");
    expect(screen.getByTestId("profile")).toHaveTextContent("expanded");
    expect(localStorage.getItem("c64u_display_profile_override")).toBe("expanded");
    expect(document.documentElement.dataset.displayProfile).toBe("expanded");
    expect(document.documentElement.style.getPropertyValue("--display-profile-root-font-size")).toBe("17.5px");

    act(() => {
      setViewportWidth(700);
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByTestId("auto-profile")).toHaveTextContent("expanded");
    expect(screen.getByTestId("profile")).toHaveTextContent("expanded");
  });
});
