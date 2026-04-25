import { describe, expect, it } from "vitest";

import { resolveTransitionConfig } from "@/components/SwipeNavigationLayer";

describe("SwipeNavigationLayer transition config", () => {
    it("keeps compact profile transitions smooth when runtime motion remains standard", () => {
        const transitionConfig = resolveTransitionConfig("compact", "standard", 0);

        expect(transitionConfig).toEqual({
            durationMs: 220,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            reducedEffects: false,
        });
    });

    it("still reduces compact transitions when runtime motion mode is reduced", () => {
        const transitionConfig = resolveTransitionConfig("compact", "reduced", 0);

        expect(transitionConfig).toEqual({
            durationMs: 180,
            easing: "linear",
            reducedEffects: true,
        });
    });
});
