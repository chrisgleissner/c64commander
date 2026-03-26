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

  it("lets compact labels and descriptions wrap instead of clipping", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <QuickActionCard
          icon={Play}
          label="Very long compact action label"
          description="Readable secondary copy should wrap on compact displays"
          onClick={() => undefined}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByText("Very long compact action label").className).toContain("text-[11px]");
    expect(screen.getByText("Very long compact action label").className).toContain("whitespace-normal");
    expect(screen.getByText("Very long compact action label").className).toContain("break-normal");
    expect(screen.getByText("Readable secondary copy should wrap on compact displays").className).toContain(
      "break-words",
    );
  });
});
