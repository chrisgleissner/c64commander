import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useC64ConfigItems, useC64Connection, useC64UpdateConfigBatch } from '@/hooks/useC64Connection';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { reportUserError } from '@/lib/uiErrors';
import { getC64API } from '@/lib/c64api';
import { isSidVolumeName, resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';
import {
    AUDIO_MIXER_VOLUME_ITEMS,
    SID_ADDRESSING_ITEMS,
    SID_SOCKETS_ITEMS,
} from '@/lib/config/configItems';
import {
    buildEnabledSidUnmuteUpdates,
    buildEnabledSidRestoreUpdates,
    buildEnabledSidVolumeSnapshot,
    buildSidEnablement,
    buildSidVolumeSteps,
    filterEnabledSidVolumeItems,
    buildEnabledSidMuteUpdates,
    buildEnabledSidVolumeUpdates,
    type SidEnablement,
} from '@/lib/config/sidVolumeControl';
import { reduceVolumeState } from '../volumeState';
import {
    extractAudioMixerItems,
    parseVolumeOption,
} from '../playFilesUtils';
import { resolveVolumeSyncDecision } from '../playbackGuards';

type SidMuteSnapshot = {
    volumes: Record<string, string | number>;
    enablement: SidEnablement;
};

interface UseVolumeOverrideProps {
    isPlaying: boolean;
    isPaused: boolean;
}

export function useVolumeOverride({ isPlaying, isPaused }: UseVolumeOverrideProps) {
    const { status } = useC64Connection();
    const updateConfigBatch = useC64UpdateConfigBatch();

    const { data: audioMixerCategory } = useC64ConfigItems(
        'Audio Mixer',
        AUDIO_MIXER_VOLUME_ITEMS,
        status.isConnected || status.isConnecting,
    );
    const { data: sidSocketsCategory } = useC64ConfigItems(
        'SID Sockets Configuration',
        SID_SOCKETS_ITEMS,
        status.isConnected || status.isConnecting,
    );
    const { data: sidAddressingCategory } = useC64ConfigItems(
        'SID Addressing',
        SID_ADDRESSING_ITEMS,
        status.isConnected || status.isConnecting,
    );

    const audioMixerItems = useMemo(() => extractAudioMixerItems(audioMixerCategory as Record<string, unknown> | undefined), [audioMixerCategory]);
    const sidVolumeItems = useMemo(
        () => audioMixerItems.filter((item) => isSidVolumeName(item.name)),
        [audioMixerItems],
    );
    const sidEnablement = useMemo(
        () =>
            buildSidEnablement(
                sidSocketsCategory as Record<string, unknown> | undefined,
                sidAddressingCategory as Record<string, unknown> | undefined,
            ),
        [sidAddressingCategory, sidSocketsCategory],
    );
    const enabledSidVolumeItems = useMemo(
        () => filterEnabledSidVolumeItems(sidVolumeItems, sidEnablement),
        [sidEnablement, sidVolumeItems],
    );
    const volumeSteps = useMemo(() => {
        const baseOptions = sidVolumeItems.find((item) => Array.isArray(item.options) && item.options.length)?.options ?? [];
        return buildSidVolumeSteps(baseOptions);
    }, [sidVolumeItems]);

    const [volumeState, dispatchVolume] = useReducer(reduceVolumeState, {
        index: 0,
        muted: false,
        reason: null,
    });

    const manualMuteSnapshotRef = useRef<SidMuteSnapshot | null>(null);
    const pauseMuteSnapshotRef = useRef<SidMuteSnapshot | null>(null);
    const volumeSessionSnapshotRef = useRef<Record<string, string | number> | null>(null);
    const volumeSessionActiveRef = useRef(false);
    const previousVolumeIndexRef = useRef<number | null>(null);
    const volumeUpdateTimerRef = useRef<number | null>(null);
    const volumeUpdateSeqRef = useRef(0);
    const volumeUiTargetRef = useRef<{ index: number; setAtMs: number } | null>(null);

    const defaultVolumeIndex = useMemo(() => {
        const zeroIndex = volumeSteps.findIndex((option) => option.numeric === 0);
        return zeroIndex >= 0 ? zeroIndex : 0;
    }, [volumeSteps]);

    const volumeIndex = volumeState.index;
    const volumeMuted = volumeState.muted;

    const resolveVolumeIndex = useCallback((value: string | number) => {
        if (!volumeSteps.length) return defaultVolumeIndex;
        const stringValue = typeof value === 'string' ? value.trim() : value.toString();
        const directIndex = volumeSteps.findIndex((option) => option.option.trim() === stringValue);
        if (directIndex >= 0) return directIndex;
        const numeric = typeof value === 'number' ? value : parseVolumeOption(value);
        if (numeric !== undefined) {
            const numericIndex = volumeSteps.findIndex((option) => option.numeric === numeric);
            if (numericIndex >= 0) return numericIndex;
        }
        return defaultVolumeIndex;
    }, [defaultVolumeIndex, volumeSteps]);

    const captureSidMuteSnapshot = useCallback((items: typeof sidVolumeItems, enablement: SidEnablement) => ({
        volumes: buildEnabledSidVolumeSnapshot(items, enablement),
        enablement: { ...enablement },
    }), [buildEnabledSidVolumeSnapshot]);

    const snapshotToUpdates = useCallback((
        snapshot: SidMuteSnapshot | null | undefined,
        currentItems?: typeof sidVolumeItems,
    ) => {
        if (!snapshot) return {};
        const updates = buildEnabledSidUnmuteUpdates(snapshot.volumes, sidEnablement);
        if (!currentItems?.length) return updates;
        const allowedNames = new Set(currentItems.map((item) => item.name));
        return Object.fromEntries(
            Object.entries(updates).filter(([name]) => allowedNames.has(name)),
        );
    }, [buildEnabledSidUnmuteUpdates, sidEnablement]);

    const reserveVolumeUiTarget = useCallback((index: number) => {
        volumeUiTargetRef.current = {
            index,
            setAtMs: Date.now(),
        };
    }, []);

    const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number, operation: string) => {
        let timeoutId: number | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs);
        });
        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
    }, []);

    const applyAudioMixerUpdates = useCallback(async (updates: Record<string, string | number>, context: string) => {
        if (!Object.keys(updates).length) return;
        try {
            await withTimeout(
                updateConfigBatch.mutateAsync({ category: 'Audio Mixer', updates, immediate: true }),
                4000,
                `${context} audio mixer update`,
            );
        } catch (error) {
            if (context.startsWith('Restore')) {
                addErrorLog('Audio mixer restore failed', { error: (error as Error).message, context });
                toast({
                    variant: 'destructive',
                    title: 'Could not restore volume settings',
                    description: 'Your current volume may be different than before playback.',
                });
                return;
            }
            reportUserError({
                operation: 'VOLUME_UPDATE',
                title: 'Audio mixer update failed',
                description: (error as Error).message,
                error,
                context: {
                    context,
                    updates: Object.keys(updates),
                },
            });
        }
    }, [reportUserError, updateConfigBatch, withTimeout]);

    const resolveSidVolumeItems = useCallback(async (forceRefresh = false) => {
        if (sidVolumeItems.length && !forceRefresh) return sidVolumeItems;
        try {
            const data = await getC64API().getConfigItems('Audio Mixer', AUDIO_MIXER_VOLUME_ITEMS);
            return extractAudioMixerItems(data as Record<string, unknown>).filter((item) => isSidVolumeName(item.name));
        } catch (error) {
            addErrorLog('Audio mixer lookup failed', { error: (error as Error).message });
            return [];
        }
    }, [sidVolumeItems]);

    const resolveSidEnablement = useCallback(async (forceRefresh = false) => {
        if (!forceRefresh && sidSocketsCategory && sidAddressingCategory) {
            return buildSidEnablement(
                sidSocketsCategory as Record<string, unknown>,
                sidAddressingCategory as Record<string, unknown>,
            );
        }
        try {
            const api = getC64API();
            const [sockets, addressing] = await Promise.all([
                api.getConfigItems('SID Sockets Configuration', SID_SOCKETS_ITEMS),
                api.getConfigItems('SID Addressing', SID_ADDRESSING_ITEMS),
            ]);
            return buildSidEnablement(
                sockets as Record<string, unknown>,
                addressing as Record<string, unknown>,
            );
        } catch (error) {
            addErrorLog('SID enablement lookup failed', { error: (error as Error).message });
            return sidEnablement;
        }
    }, [sidAddressingCategory, sidEnablement, sidSocketsCategory]);

    const resolveEnabledSidVolumeItems = useCallback(async (forceRefresh = false) => {
        const items = await resolveSidVolumeItems(forceRefresh);
        const enablement = forceRefresh ? await resolveSidEnablement(true) : sidEnablement;
        return filterEnabledSidVolumeItems(items, enablement);
    }, [resolveSidEnablement, resolveSidVolumeItems, sidEnablement]);

    const ensureVolumeSessionSnapshot = useCallback(async () => {
        if (!isPlaying && !isPaused) return null;
        if (volumeSessionSnapshotRef.current) return volumeSessionSnapshotRef.current;
        const items = enabledSidVolumeItems.length
            ? enabledSidVolumeItems
            : await resolveEnabledSidVolumeItems(true);
        if (!items.length) return null;
        const snapshot = buildEnabledSidVolumeSnapshot(items, sidEnablement);
        volumeSessionSnapshotRef.current = snapshot;
        volumeSessionActiveRef.current = true;
        return snapshot;
    }, [buildEnabledSidVolumeSnapshot, enabledSidVolumeItems, isPaused, isPlaying, resolveEnabledSidVolumeItems, sidEnablement]);

    const restoreVolumeOverrides = useCallback(async (reason: string) => {
        if (!volumeSessionActiveRef.current) return;
        const snapshot = volumeSessionSnapshotRef.current;
        if (!snapshot) return;
        if (status.state === 'DEMO_ACTIVE' || (!status.isConnected && !status.isConnecting)) {
            volumeSessionSnapshotRef.current = null;
            volumeSessionActiveRef.current = false;
            manualMuteSnapshotRef.current = null;
            pauseMuteSnapshotRef.current = null;
            dispatchVolume({ type: 'reset', index: defaultVolumeIndex });
            volumeUiTargetRef.current = null;
            return;
        }
        const items = await resolveEnabledSidVolumeItems(true);
        const updates = buildEnabledSidRestoreUpdates(items, sidEnablement, snapshot);
        if (Object.keys(updates).length) {
            await applyAudioMixerUpdates(updates, `Restore (${reason})`);
        }
        volumeSessionSnapshotRef.current = null;
        volumeSessionActiveRef.current = false;
        manualMuteSnapshotRef.current = null;
        pauseMuteSnapshotRef.current = null;
        dispatchVolume({ type: 'reset', index: defaultVolumeIndex });
        volumeUiTargetRef.current = null;
    }, [applyAudioMixerUpdates, buildEnabledSidRestoreUpdates, defaultVolumeIndex, resolveEnabledSidVolumeItems, sidEnablement, status.isConnected, status.isConnecting, status.state]);

    const scheduleVolumeUpdate = useCallback((nextIndex: number, immediate = false) => {
        if (!volumeSteps.length || !sidVolumeItems.length) return;
        const target = volumeSteps[nextIndex]?.option;
        if (!target) return;
        const updates = buildEnabledSidVolumeUpdates(sidVolumeItems, sidEnablement, target);
        manualMuteSnapshotRef.current = null;
        previousVolumeIndexRef.current = nextIndex;

        volumeUpdateSeqRef.current += 1;
        const token = volumeUpdateSeqRef.current;
        reserveVolumeUiTarget(nextIndex);

        const runUpdate = () => {
            if (token !== volumeUpdateSeqRef.current) return;
            void ensureVolumeSessionSnapshot();
            void applyAudioMixerUpdates(updates, 'Volume').finally(() => {
                const pendingTarget = volumeUiTargetRef.current;
                if (pendingTarget?.index !== nextIndex) return;
                if (Date.now() - pendingTarget.setAtMs >= 2500) {
                    volumeUiTargetRef.current = null;
                }
            });
            dispatchVolume({ type: 'unmute', reason: 'manual' });
        };

        if (volumeUpdateTimerRef.current) {
            window.clearTimeout(volumeUpdateTimerRef.current);
            volumeUpdateTimerRef.current = null;
        }

        if (immediate) {
            runUpdate();
            return;
        }

        volumeUpdateTimerRef.current = window.setTimeout(runUpdate, 200);
    }, [applyAudioMixerUpdates, buildEnabledSidVolumeUpdates, ensureVolumeSessionSnapshot, reserveVolumeUiTarget, sidEnablement, sidVolumeItems, volumeSteps]);

    const handleVolumeLocalChange = useCallback((value: number[]) => {
        const nextIndex = value[0] ?? 0;
        dispatchVolume({ type: 'set-index', index: nextIndex });
        reserveVolumeUiTarget(nextIndex);
        if (!volumeMuted) return;
        previousVolumeIndexRef.current = nextIndex;
        const snapshot = manualMuteSnapshotRef.current;
        const target = volumeSteps[nextIndex]?.option;
        if (snapshot && target) {
            manualMuteSnapshotRef.current = {
                ...snapshot,
                volumes: Object.fromEntries(
                    Object.keys(snapshot.volumes).map((key) => [key, target]),
                ),
            };
        }
    }, [reserveVolumeUiTarget, volumeMuted, volumeSteps]);

    const handleVolumeAsyncChange = useCallback((nextIndex: number) => {
        if (volumeMuted) return;
        scheduleVolumeUpdate(nextIndex);
    }, [scheduleVolumeUpdate, volumeMuted]);

    const handleVolumeCommit = useCallback(async (nextIndex: number) => {
        dispatchVolume({ type: 'set-index', index: nextIndex });
        reserveVolumeUiTarget(nextIndex);
        if (volumeMuted) {
            previousVolumeIndexRef.current = nextIndex;
            const snapshot = manualMuteSnapshotRef.current;
            const target = volumeSteps[nextIndex]?.option;
            if (snapshot && target) {
                manualMuteSnapshotRef.current = {
                    ...snapshot,
                    volumes: Object.fromEntries(
                        Object.keys(snapshot.volumes).map((key) => [key, target]),
                    ),
                };
            }
            return;
        }
        scheduleVolumeUpdate(nextIndex, true);
    }, [reserveVolumeUiTarget, scheduleVolumeUpdate, volumeMuted, volumeSteps]);

    const handleToggleMute = useCallback(async () => {
        const items = await resolveEnabledSidVolumeItems(true);
        if (!items.length) return;
        if (!volumeMuted) {
            previousVolumeIndexRef.current = volumeIndex;
            await ensureVolumeSessionSnapshot();
            manualMuteSnapshotRef.current = captureSidMuteSnapshot(items, sidEnablement);
            dispatchVolume({ type: 'mute', reason: 'manual' });
            volumeUiTargetRef.current = null;
            await applyAudioMixerUpdates(buildEnabledSidMuteUpdates(items, sidEnablement), 'Mute');
            return;
        }
        const snapshot = manualMuteSnapshotRef.current;
        let updates = snapshotToUpdates(snapshot, items);
        if (!Object.keys(updates).length) {
            const fallbackIndex = previousVolumeIndexRef.current ?? volumeIndex;
            const target = volumeSteps[fallbackIndex]?.option;
            if (target) {
                updates = buildEnabledSidVolumeUpdates(items, sidEnablement, target);
            }
        }
        if (Object.keys(updates).length) {
            await applyAudioMixerUpdates(updates, 'Unmute');
        }
        dispatchVolume({ type: 'unmute', reason: 'manual' });
        manualMuteSnapshotRef.current = null;
        volumeUiTargetRef.current = null;
    }, [
        applyAudioMixerUpdates,
        captureSidMuteSnapshot,
        ensureVolumeSessionSnapshot,
        resolveEnabledSidVolumeItems,
        sidEnablement,
        snapshotToUpdates,
        volumeIndex,
        volumeMuted,
        volumeSteps,
    ]);

    useEffect(() => {
        if (updateConfigBatch.isPending) return;
        if (!enabledSidVolumeItems.length || !volumeSteps.length) {
            dispatchVolume({ type: 'reset', index: defaultVolumeIndex });
            volumeUiTargetRef.current = null;
            return;
        }
        const muteValues = enabledSidVolumeItems.map((item) => resolveAudioMixerMuteValue(item.options));
        const activeIndices: number[] = [];
        enabledSidVolumeItems.forEach((item, index) => {
            if (item.value === muteValues[index]) return;
            activeIndices.push(resolveVolumeIndex(item.value));
        });
        if (manualMuteSnapshotRef.current && volumeMuted && activeIndices.length) {
            return;
        }
        if (!activeIndices.length) {
            const snapshot = manualMuteSnapshotRef.current;
            const snapshotIndices = snapshot
                ? Object.values(snapshot.volumes).map((value) => resolveVolumeIndex(value))
                : [];
            const muteIndices = muteValues.map((value) => resolveVolumeIndex(value));
            const muteCounts = new Map<number, number>();
            muteIndices.forEach((index) => muteCounts.set(index, (muteCounts.get(index) ?? 0) + 1));
            const muteIndex = Array.from(muteCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
            let nextIndex = muteIndex;
            if (snapshotIndices.length) {
                const counts = new Map<number, number>();
                snapshotIndices.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
                nextIndex = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
            }
            dispatchVolume({ type: 'sync', index: nextIndex, muted: true });
            return;
        }
        const counts = new Map<number, number>();
        activeIndices.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
        const nextIndex = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
        const syncDecision = resolveVolumeSyncDecision(volumeUiTargetRef.current, nextIndex, Date.now());
        if (syncDecision === 'defer') {
            return;
        }
        if (syncDecision === 'clear') {
            volumeUiTargetRef.current = null;
        }
        dispatchVolume({ type: 'sync', index: nextIndex, muted: false });
    }, [defaultVolumeIndex, enabledSidVolumeItems, resolveVolumeIndex, updateConfigBatch.isPending, volumeSteps, volumeMuted]);

    useEffect(() => {
        return () => {
            if (volumeUpdateTimerRef.current) {
                window.clearTimeout(volumeUpdateTimerRef.current);
                volumeUpdateTimerRef.current = null;
            }
        };
    }, []);

    return {
        volumeState,
        dispatchVolume,
        volumeSteps,
        sidVolumeItems,
        sidEnablement,
        enabledSidVolumeItems,
        resolveVolumeIndex,
        resolveEnabledSidVolumeItems,
        restoreVolumeOverrides,
        ensureVolumeSessionSnapshot,
        reserveVolumeUiTarget,
        applyAudioMixerUpdates,
        manualMuteSnapshotRef,
        pauseMuteSnapshotRef,
        volumeSessionSnapshotRef,
        volumeSessionActiveRef,
        volumeUpdateTimerRef,
        volumeUpdateSeqRef,
        captureSidMuteSnapshot,
        snapshotToUpdates,
        handleVolumeLocalChange,
        handleVolumeAsyncChange,
        handleVolumeCommit,
        handleToggleMute,
    };
}
