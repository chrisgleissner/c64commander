import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageContainer, ProfileActionGrid, ProfileSplitSection } from "@/components/layout/PageContainer";
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

    expect(screen.getByTestId("container-child").closest("section")).toHaveStyle({ maxWidth: "100%" });
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
});
