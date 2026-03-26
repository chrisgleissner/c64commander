/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SourceLocation, SourceLocationType } from "./types";

const ARCHIVE_SOURCE_IDS: Record<string, string> = {
    commoserve: "archive-commoserve",
    assembly64: "archive-assembly64",
};

export const createArchiveSourceLocation = (
    type: Extract<SourceLocationType, "commoserve" | "assembly64">,
): SourceLocation => ({
    id: ARCHIVE_SOURCE_IDS[type],
    type,
    name: type === "commoserve" ? "CommoServe" : "Assembly64",
    rootPath: "/",
    isAvailable: true,
    listEntries: async () => [],
    listFilesRecursive: async () => [],
});
