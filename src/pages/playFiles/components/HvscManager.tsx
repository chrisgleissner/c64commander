import { useCallback } from 'react';
import { useHvscLibrary } from '../hooks/useHvscLibrary';
import { HvscControls } from './HvscControls';
import { getHvscFolderListing } from '@/lib/hvsc';
import { reportUserError } from '@/lib/uiErrors';
import { formatBytes } from '../playFilesUtils';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import type { PlayableEntry } from '../types';

interface HvscManagerProps {
    recurseFolders: boolean;
    onPlayEntry: (entry: PlayableEntry) => void;
    onPlayEntries: (entries: PlayableEntry[]) => void;
    onAddToPlaylist: (entry: PlayableEntry) => void;
    hvscControlsEnabled: boolean;
}

export function HvscManager({
    recurseFolders,
    onPlayEntry,
    onPlayEntries,
    onAddToPlaylist,
    hvscControlsEnabled,
}: HvscManagerProps) {
    const hvsc = useHvscLibrary();
    const {
        hvscStatus,
        hvscRoot,
        buildHvscLocalPlayFile,
        formatHvscDuration,
        formatHvscTimestamp,
    } = hvsc;

    const buildHvscFile = useCallback((song: { id: number; virtualPath: string; fileName: string }) => {
        return buildHvscLocalPlayFile(song.virtualPath, song.fileName) as LocalPlayFile;
    }, [buildHvscLocalPlayFile]);

    const collectHvscSongs = useCallback(async (rootPath: string) => {
        const queuePaths = [rootPath || '/'];
        const results: Array<{ id: number; virtualPath: string; fileName: string; durationSeconds?: number | null }> = [];
        const visited = new Set<string>();
        while (queuePaths.length) {
            const currentPath = queuePaths.shift();
            if (!currentPath || visited.has(currentPath)) continue;
            visited.add(currentPath);
            const listing = await getHvscFolderListing(currentPath);
            listing.songs.forEach((song) => {
                results.push(song);
            });
            if (recurseFolders) {
                listing.folders.forEach((folder) => queuePaths.push(folder));
            }
        }
        return results;
    }, [recurseFolders]);

    const handlePlayHvscFolder = useCallback(async (path: string) => {
        try {
            if (!hvscStatus?.installedVersion) {
                reportUserError({
                    operation: 'HVSC_PLAYBACK',
                    title: 'HVSC unavailable',
                    description: 'Install HVSC to play the collection.',
                    context: { path },
                });
                return;
            }
            const songs = await collectHvscSongs(path);
            if (!songs.length) {
                reportUserError({
                    operation: 'HVSC_PLAYBACK',
                    title: 'No HVSC songs',
                    description: 'No SID files found in this folder.',
                    context: { path },
                });
                return;
            }
            const entries: PlayableEntry[] = songs.map((song) => ({
                source: 'hvsc',
                name: song.fileName,
                path: song.virtualPath,
                file: buildHvscFile(song),
                durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
                sourceId: hvscRoot.path,
            }));
            onPlayEntries(entries);
        } catch (error) {
            reportUserError({
                operation: 'HVSC_PLAYBACK',
                title: 'Playback failed',
                description: (error as Error).message,
                error,
                context: { path },
            });
        }
    }, [buildHvscFile, collectHvscSongs, hvscRoot.path, hvscStatus?.installedVersion, onPlayEntries]);

    if (!hvscControlsEnabled) {
        return null;
    }

    return (
        <HvscControls
            {...hvsc}
            formatBytes={formatBytes}
            formatHvscDuration={formatHvscDuration}
            formatHvscTimestamp={formatHvscTimestamp}
            onPlayEntry={onPlayEntry}
            onAddToPlaylist={onAddToPlaylist}
            onPlayFolder={handlePlayHvscFolder}
            buildHvscFile={buildHvscFile}
            hvscRootPath={hvscRoot.path}
        />
    );
}
