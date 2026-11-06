/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getDiskWorkClientId } from "@/lib/disks/diskWorkClientId";

export type InstallStagedFileKind = "reu" | "preload" | "cfg";

const STAGED_FILE_EXTENSION: Record<InstallStagedFileKind, string> = { reu: "reu", preload: "reu", cfg: "cfg" };

/**
 * The device file this install uploads an REU image or config file to before selecting it over Telnet. Every phone
 * that drives the same Ultimate stages into the same folders, so the name carries this install's id: with a shared
 * name another phone's upload could replace the bytes between this install's upload and its Telnet step. The
 * extension stays, because the device's file browser offers the REU and config actions by extension.
 */
export const buildInstallStagedFileName = (kind: InstallStagedFileKind) =>
  `c64commander-${kind}-${getDiskWorkClientId()}.${STAGED_FILE_EXTENSION[kind]}`;
