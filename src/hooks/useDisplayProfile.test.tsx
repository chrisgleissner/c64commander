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

const setViewportHeight = (height: number) => {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
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
    setViewportHeight(640);

    render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("auto-profile")).toHaveTextContent("compact");
    expect(screen.getByTestId("profile")).toHaveTextContent("compact");
    expect(document.documentElement.dataset.displayProfile).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--display-profile-root-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--display-profile-viewport-width")).toBe("320px");

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
    expect(document.documentElement.style.getPropertyValue("--display-profile-viewport-width")).toBe("700px");
  });

  it("refreshes the override when localStorage changes arrive through a storage event", () => {
    localStorage.clear();
    setViewportWidth(320);
    setViewportHeight(640);

    render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("profile")).toHaveTextContent("compact");
    localStorage.setItem("c64u_display_profile_override", "expanded");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "c64u_display_profile_override",
          newValue: "expanded",
          storageArea: window.localStorage,
        }),
      );
    });

    expect(screen.getByTestId("override")).toHaveTextContent("expanded");
    expect(screen.getByTestId("profile")).toHaveTextContent("expanded");
    expect(document.documentElement.dataset.displayProfile).toBe("expanded");
  });

  it("ignores unrelated storage changes", () => {
    localStorage.clear();
    setViewportWidth(320);
    setViewportHeight(640);

    render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "c64u_list_preview_limit",
          newValue: "20",
          storageArea: window.localStorage,
        }),
      );
    });

    expect(screen.getByTestId("override")).toHaveTextContent("auto");
    expect(screen.getByTestId("profile")).toHaveTextContent("compact");
  });

  it("ignores preference change events that do not carry a display-profile override", () => {
    localStorage.clear();
    setViewportWidth(320);
    setViewportHeight(640);

    render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-ui-preferences-changed", {
          detail: { listPreviewLimit: 20 },
        }),
      );
    });

    expect(screen.getByTestId("override")).toHaveTextContent("auto");
    expect(screen.getByTestId("profile")).toHaveTextContent("compact");
  });

  it("refreshes the override when storage is cleared and ignores non-local storage events", () => {
    localStorage.clear();
    setViewportWidth(320);
    setViewportHeight(640);
    localStorage.setItem("c64u_display_profile_override", "expanded");

    render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("override")).toHaveTextContent("expanded");
    expect(screen.getByTestId("profile")).toHaveTextContent("expanded");

    localStorage.removeItem("c64u_display_profile_override");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: null,
          storageArea: window.localStorage,
        }),
      );
    });

    expect(screen.getByTestId("override")).toHaveTextContent("auto");
    expect(screen.getByTestId("profile")).toHaveTextContent("compact");

    localStorage.setItem("c64u_display_profile_override", "expanded");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "c64u_display_profile_override",
          newValue: "expanded",
          storageArea: window.sessionStorage,
        }),
      );
    });

    expect(screen.getByTestId("override")).toHaveTextContent("auto");
    expect(screen.getByTestId("profile")).toHaveTextContent("compact");
  });

  it("restores the previous root dataset and CSS variables on unmount", () => {
    localStorage.clear();
    setViewportWidth(320);
    setViewportHeight(640);
    document.documentElement.dataset.displayProfile = "expanded";
    document.documentElement.style.setProperty("--display-profile-root-font-size", "19px");
    document.documentElement.style.setProperty("--display-profile-viewport-width", "999px");

    const { unmount } = render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    expect(document.documentElement.dataset.displayProfile).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--display-profile-root-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--display-profile-viewport-width")).toBe("320px");

    unmount();

    expect(document.documentElement.dataset.displayProfile).toBe("expanded");
    expect(document.documentElement.style.getPropertyValue("--display-profile-root-font-size")).toBe("19px");
    expect(document.documentElement.style.getPropertyValue("--display-profile-viewport-width")).toBe("999px");
  });

  it("removes provider-owned root state on unmount when no previous values existed", () => {
    localStorage.clear();
    setViewportWidth(320);
    setViewportHeight(640);
    delete document.documentElement.dataset.displayProfile;
    document.documentElement.style.removeProperty("--display-profile-root-font-size");
    document.documentElement.style.removeProperty("--display-profile-viewport-width");

    const { unmount } = render(
      <DisplayProfileProvider>
        <Consumer />
      </DisplayProfileProvider>,
    );

    expect(document.documentElement.dataset.displayProfile).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--display-profile-root-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--display-profile-viewport-width")).toBe("320px");

    unmount();

    expect(document.documentElement.dataset.displayProfile).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--display-profile-root-font-size")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--display-profile-viewport-width")).toBe("");
  });
});
