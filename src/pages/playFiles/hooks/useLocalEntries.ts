import { useMemo } from 'react';
import {
    getLocalSourceListingMode,
    requireLocalSourceEntries,
    type LocalSourceRecord,
} from '@/lib/sourceNavigation/localSourcesStore';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { addErrorLog } from '@/lib/logging';

export function useLocalEntries(localSources: LocalSourceRecord[]) {
    const localEntriesBySourceId = useMemo(() => {
        const map = new Map<
            string,
            Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>
        >();
        localSources.forEach((source) => {
            if (getLocalSourceListingMode(source) !== 'entries') {
                map.set(source.id, new Map());
                return;
            }
            try {
                const entries = requireLocalSourceEntries(source, 'useLocalEntries');
                const entriesMap = new Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>();
                entries.forEach((entry) => {
                    entriesMap.set(normalizeSourcePath(entry.relativePath), {
                        uri: entry.uri,
                        name: entry.name,
                        modifiedAt: entry.modifiedAt ?? null,
                        sizeBytes: entry.sizeBytes ?? null,
                    });
                });
                map.set(source.id, entriesMap);
            } catch (error) {
                addErrorLog('Local source entries unavailable', {
                    sourceId: source.id,
                    error: {
                        name: (error as Error).name,
                        message: (error as Error).message,
                        stack: (error as Error).stack,
                    },
                });
                map.set(source.id, new Map());
            }
        });
        return map;
    }, [localSources]);

    const localSourceTreeUris = useMemo(() => {
        const map = new Map<string, string | null>();
        localSources.forEach((source) => {
            map.set(source.id, source.android?.treeUri ?? null);
        });
        return map;
    }, [localSources]);

    return { localEntriesBySourceId, localSourceTreeUris };
}
