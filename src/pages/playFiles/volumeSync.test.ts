import { describe, expect, it } from "vitest";
import { resolveMostCommonIndex, resolveMutedSyncIndex, shouldHoldManualMuteSync } from "@/pages/playFiles/volumeSync";

describe("volumeSync", () => {
    it("keeps manual mute authoritative while the device still reports active volume", () => {
        expect(shouldHoldManualMuteSync(true, [24, 24])).toBe(true);
        expect(shouldHoldManualMuteSync(true, [])).toBe(false);
        expect(shouldHoldManualMuteSync(false, [24, 24])).toBe(false);
    });

    it("uses the explicit muted index while manual mute intent is active", () => {
        expect(
            resolveMutedSyncIndex({
                manualMuteIntentActive: true,
                muteIndex: 1,
                snapshotIndices: [24, 24],
                defaultVolumeIndex: 24,
            }),
        ).toBe(1);
    });

    it("falls back to the snapshot majority when mute came from non-manual sync", () => {
        expect(
            resolveMutedSyncIndex({
                manualMuteIntentActive: false,
                muteIndex: 1,
                snapshotIndices: [24, 24, 18],
                defaultVolumeIndex: 24,
            }),
        ).toBe(24);
    });

    it("counts repeated indices when resolving the most common device volume", () => {
        expect(resolveMostCommonIndex([18, 24, 24, 18, 24], 1)).toBe(24);
    });

    it("falls back to the muted index when non-manual sync has no snapshot history", () => {
        expect(
            resolveMutedSyncIndex({
                manualMuteIntentActive: false,
                muteIndex: 1,
                snapshotIndices: [],
                defaultVolumeIndex: 24,
            }),
        ).toBe(1);
    });

    it("returns the fallback when there is no index majority", () => {
        expect(resolveMostCommonIndex([], 24)).toBe(24);
    });
});
