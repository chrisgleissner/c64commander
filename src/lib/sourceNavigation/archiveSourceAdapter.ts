/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import type { SourceLocation } from "./types";

export const createArchiveSourceLocation = (config: ArchiveClientConfigInput): SourceLocation => ({
    id: config.id,
    type: "commoserve",
    name: config.name,
    rootPath: "/",
    isAvailable: config.enabled ?? true,
    listEntries: async () => [],
    listFilesRecursive: async () => [],
});
