export const resolveMostCommonIndex = (indices: number[], fallbackIndex: number) => {
    if (!indices.length) return fallbackIndex;
    const counts = new Map<number, number>();
    indices.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? fallbackIndex;
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
