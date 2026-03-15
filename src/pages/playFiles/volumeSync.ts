export const resolveMostCommonIndex = (indices: number[], fallbackIndex: number) => {
    if (!indices.length) return fallbackIndex;
    const counts = new Map<number, number>();
    let mostCommonIndex = fallbackIndex;
    let mostCommonCount = 0;

    for (const index of indices) {
        const nextCount = (counts.get(index) ?? 0) + 1;
        counts.set(index, nextCount);
        if (nextCount > mostCommonCount) {
            mostCommonCount = nextCount;
            mostCommonIndex = index;
        }
    }

    return mostCommonIndex;
};

export const shouldHoldManualMuteSync = (manualMuteIntentActive: boolean, activeIndices: number[]) =>
    manualMuteIntentActive && activeIndices.length > 0;

export const resolveMutedSyncIndex = (params: {
    manualMuteIntentActive: boolean;
    muteIndex: number;
    snapshotIndices: number[];
    defaultVolumeIndex: number;
}) => {
    const { manualMuteIntentActive, muteIndex, snapshotIndices, defaultVolumeIndex } = params;
    if (manualMuteIntentActive) return muteIndex;
    return snapshotIndices.length ? resolveMostCommonIndex(snapshotIndices, defaultVolumeIndex) : muteIndex;
};
