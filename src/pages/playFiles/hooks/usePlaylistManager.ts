import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORY_OPTIONS, shuffleArray } from '../playFilesUtils';
import type { PlayFileCategory, PlaylistItem } from '@/pages/playFiles/types';

export function usePlaylistManager() {
    const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [shuffleEnabled, setShuffleEnabled] = useState(false);
    const [repeatEnabled, setRepeatEnabled] = useState(false);
    const [playlistTypeFilters, setPlaylistTypeFilters] = useState<PlayFileCategory[]>(CATEGORY_OPTIONS);
    const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
    const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
    const [reshuffleActive, setReshuffleActive] = useState(false);

    const reshuffleTimerRef = useRef<number | null>(null);

    useEffect(() => {
        setSelectedPlaylistIds((prev) => {
            if (!prev.size) return prev;
            const ids = new Set(playlist.map((item) => item.id));
            const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [playlist]);

    const reshufflePlaylist = useCallback((items: PlaylistItem[], lockedIndex: number) => {
        if (items.length < 2) return items;
        if (lockedIndex >= 0 && lockedIndex < items.length) {
            const currentItem = items[lockedIndex];
            const rest = items.filter((_, index) => index !== lockedIndex);
            const shuffled = shuffleArray(rest);
            const insertIndex = Math.min(lockedIndex, shuffled.length);
            let next = [...shuffled.slice(0, insertIndex), currentItem, ...shuffled.slice(insertIndex)];
            if (next.map((item) => item.id).join('|') === items.map((item) => item.id).join('|')) {
                if (rest.length > 1) {
                    const swapped = [...shuffled];
                    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
                    next = [...swapped.slice(0, insertIndex), currentItem, ...swapped.slice(insertIndex)];
                }
            }
            return next;
        }

        let shuffled = shuffleArray(items);
        if (shuffled.map((item) => item.id).join('|') === items.map((item) => item.id).join('|')) {
            if (shuffled.length > 1) {
                const swapped = [...shuffled];
                [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
                shuffled = swapped;
            }
        }
        return shuffled;
    }, []);

    const handleReshuffle = useCallback(() => {
        if (!shuffleEnabled || !playlist.length) return;
        setReshuffleActive(true);
        if (reshuffleTimerRef.current) {
            window.clearTimeout(reshuffleTimerRef.current);
        }
        reshuffleTimerRef.current = window.setTimeout(() => {
            setReshuffleActive(false);
            reshuffleTimerRef.current = null;
        }, 200);
        setPlaylist((prev) => reshufflePlaylist(prev, currentIndex));
    }, [currentIndex, playlist.length, reshufflePlaylist, shuffleEnabled]);

    useEffect(() => () => {
        if (reshuffleTimerRef.current) {
            window.clearTimeout(reshuffleTimerRef.current);
            reshuffleTimerRef.current = null;
        }
    }, []);

    return {
        playlist,
        setPlaylist,
        currentIndex,
        setCurrentIndex,
        shuffleEnabled,
        setShuffleEnabled,
        repeatEnabled,
        setRepeatEnabled,
        playlistTypeFilters,
        setPlaylistTypeFilters,
        selectedPlaylistIds,
        setSelectedPlaylistIds,
        isPlaylistLoading,
        setIsPlaylistLoading,
        reshuffleActive,
        setReshuffleActive,
        handleReshuffle,
    };
}
