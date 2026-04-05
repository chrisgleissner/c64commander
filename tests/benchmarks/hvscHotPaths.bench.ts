import { bench, describe } from 'vitest';

import type { MediaEntry } from '@/lib/media-index';
import { buildHvscBrowseIndexFromEntries, listFolderFromBrowseIndex } from '@/lib/hvsc/hvscBrowseIndexStore';
import { parseDeletionList } from '@/lib/hvsc/hvscDownload';
import { archiveNameHash } from '@/lib/hvsc/hvscArchiveExtraction';

const createEntries = (count: number): MediaEntry[] =>
    Array.from({ length: count }, (_, index) => {
        const bucket = String(index % 10);
        const author = `Composer ${String(index % 250).padStart(3, '0')}`;
        return {
            path: `/MUSICIANS/${author}/${bucket}/Track_${String(index).padStart(6, '0')}.sid`,
            name: `Track_${String(index).padStart(6, '0')}.sid`,
            type: 'sid',
            durationSeconds: 180 + (index % 120),
        };
    });

const buildEntries = createEntries(50_000);
const queryEntries = createEntries(100_000);
const querySnapshot = buildHvscBrowseIndexFromEntries(queryEntries);
const deletionList = queryEntries
    .slice(0, 20_000)
    .map((entry) => entry.path.slice(1))
    .join('\n');
const archiveNames = queryEntries.slice(0, 5_000).map((entry) => entry.path);

describe('HVSC hot path microbenchmarks', () => {
    bench(
        'build browse index from 50k entries',
        () => {
            buildHvscBrowseIndexFromEntries(buildEntries);
        },
        { iterations: 5, warmupIterations: 1 },
    );

    bench(
        'query browse index page over 100k entries',
        () => {
            listFolderFromBrowseIndex(querySnapshot, '/MUSICIANS/Composer 042', 'track_000', 0, 200);
        },
        { iterations: 10, warmupIterations: 2 },
    );

    bench(
        'parse 20k update deletion entries',
        () => {
            parseDeletionList(deletionList);
        },
        { iterations: 10, warmupIterations: 2 },
    );

    bench(
        'hash 5k archive names',
        () => {
            archiveNames.forEach((name) => archiveNameHash(name));
        },
        { iterations: 10, warmupIterations: 2 },
    );
});
