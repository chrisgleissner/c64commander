import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Play } from "lucide-react";

import { QuickActionCard } from "@/components/QuickActionCard";
import { ProfileActionGrid } from "@/components/layout/PageContainer";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

describe("QuickActionCard", () => {
  it("uses compact density from the shared action-grid boundary on wide screens", () => {
    localStorage.clear();
    setViewportWidth(800);

    render(
      <DisplayProfileProvider>
        <ProfileActionGrid cardDensity="compact">
          <QuickActionCard icon={Play} label="Play" onClick={() => undefined} />
        </ProfileActionGrid>
      </DisplayProfileProvider>,
    );

    expect(screen.getByRole("button", { name: "Play" }).className).toContain("min-h-[86px]");
  });

  it("falls back to adaptive compact density on compact displays", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <QuickActionCard icon={Play} label="Play" onClick={() => undefined} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByRole("button", { name: "Play" }).className).toContain("min-h-[86px]");
  });
});
