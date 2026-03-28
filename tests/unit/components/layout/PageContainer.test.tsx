import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageContainer, PageStack, ProfileActionGrid, ProfileSplitSection } from "@/components/layout/PageContainer";
import { AppChromeModeProvider } from "@/components/layout/AppChromeContext";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

describe("profile layout primitives", () => {
  it("supports full-width reading containers and custom action minimum widths", () => {
    localStorage.clear();
    setViewportWidth(800);

    render(
      <DisplayProfileProvider>
        <PageContainer as="section" size="full">
          <div data-testid="container-child">Content</div>
        </PageContainer>
        <ProfileActionGrid compactColumns={2} mediumColumns={3} expandedColumns={5} minItemWidth="12rem" testId="grid">
          <div>One</div>
          <div>Two</div>
        </ProfileActionGrid>
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("container-child").closest("section")).toHaveStyle({ width: "100%", maxWidth: "100%" });
    expect(screen.getByTestId("grid")).toHaveStyle({ gridTemplateColumns: "repeat(5, minmax(12rem, 1fr))" });
  });

  it("uses the compact action grid column count on narrow widths", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <ProfileActionGrid compactColumns={2} mediumColumns={4} testId="grid">
          <div>One</div>
          <div>Two</div>
        </ProfileActionGrid>
      </DisplayProfileProvider>,
    );

    const grid = screen.getByTestId("grid");
    expect(grid).toHaveAttribute("data-profile", "compact");
    expect(grid).toHaveStyle({ gridTemplateColumns: "repeat(2, minmax(0px, 1fr))" });
  });

  it("keeps default and reading containers bounded and leaves split sections single-column outside expanded", () => {
    localStorage.clear();
    setViewportWidth(393);

    const { container } = render(
      <DisplayProfileProvider>
        <PageStack className="custom-stack">
          <PageContainer as="section">
            <div>Default</div>
          </PageContainer>
          <PageContainer as="section" size="reading" className="reading-shell">
            <div data-testid="reading-child">Reading</div>
          </PageContainer>
          <ProfileActionGrid compactColumns={2} mediumColumns={3} expandedColumns={5} testId="medium-grid">
            <div>One</div>
            <div>Two</div>
          </ProfileActionGrid>
          <ProfileSplitSection testId="compact-split">
            <div>Primary</div>
            <div>Secondary</div>
          </ProfileSplitSection>
        </PageStack>
      </DisplayProfileProvider>,
    );

    expect(screen.getByText("Default").closest("section")).toHaveStyle({ maxWidth: "960px" });
    expect(screen.getByTestId("reading-child").closest("section")).toHaveStyle({ maxWidth: "960px" });
    expect(container.querySelector(".custom-stack")).not.toBeNull();
    expect(screen.getByTestId("medium-grid")).toHaveStyle({ gridTemplateColumns: "repeat(3, minmax(0px, 1fr))" });
    expect(screen.getByTestId("compact-split")).toHaveAttribute("data-profile", "medium");
    expect(screen.getByTestId("compact-split").style.gridTemplateColumns).toBe("");
  });

  it("switches the split section into expanded mode on wide widths", () => {
    localStorage.clear();
    setViewportWidth(800);

    render(
      <DisplayProfileProvider>
        <ProfileSplitSection testId="split">
          <div>Primary</div>
          <div>Secondary</div>
        </ProfileSplitSection>
      </DisplayProfileProvider>,
    );

    const split = screen.getByTestId("split");
    expect(split).toHaveAttribute("data-profile", "expanded");
    expect(split.className).toContain("profile-split-section-expanded");
  });

  it("uses an explicit bounded scroll viewport below the header in sticky chrome mode", () => {
    render(
      <AppChromeModeProvider mode="sticky">
        <DisplayProfileProvider>
          <PageContainer as="section">
            <div data-testid="sticky-container-child">Content</div>
          </PageContainer>
        </DisplayProfileProvider>
      </AppChromeModeProvider>,
    );

    const container = screen.getByTestId("sticky-container-child").closest("section");
    expect(container).toHaveAttribute("data-page-scroll-container", "true");
    expect(container).toHaveStyle({ height: "calc(100% - var(--app-bar-height))", minHeight: "0" });
  });
});
