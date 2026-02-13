/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DiagnosticsDisplaySeverity } from '@/lib/diagnostics/diagnosticsSeverity';

export type DiskDosStatus = {
    code: number | null;
    severity: DiagnosticsDisplaySeverity;
    message: string | null;
    details: string | null;
    raw: string;
};

type DosStatusRule = {
    severity: DiagnosticsDisplaySeverity;
    message: string | null;
    details: string;
};

const UNUSED_DOS_CODE_MIN = 2;
const UNUSED_DOS_CODE_MAX = 19;

const DOS_STATUS_BY_CODE: Record<number, DosStatusRule> = {
    0: { severity: 'INFO', message: 'OK', details: 'Drive DOS reports normal operation. No action is needed.' },
    1: {
        severity: 'INFO',
        message: 'FILES SCRATCHED',
        details: 'Informational response after a scratch or delete command. It confirms file removal, not a failure.',
    },
    20: {
        severity: 'ERROR',
        message: 'READ ERROR (Block Header Not Found)',
        details: 'The controller could not locate the requested block header. This usually points to a bad block address or damaged media headers.',
    },
    21: {
        severity: 'ERROR',
        message: 'READ ERROR (No Sync Character)',
        details: 'No sync mark was detected on the target track. Typical causes are missing or unformatted media, alignment issues, or hardware faults.',
    },
    22: {
        severity: 'ERROR',
        message: 'READ ERROR (Data Block Not Present)',
        details: 'The requested data block is missing or was never written correctly. This often appears with invalid direct block requests.',
    },
    23: {
        severity: 'ERROR',
        message: 'READ ERROR (Checksum Error In Data Block)',
        details: 'Data was read into memory, but checksum verification failed. Corrupt media or electrical noise are common reasons.',
    },
    24: {
        severity: 'ERROR',
        message: 'READ ERROR (Byte Decoding Error)',
        details: 'The drive encountered an invalid bit pattern while decoding bytes. Media defects or signal integrity issues are likely.',
    },
    25: {
        severity: 'ERROR',
        message: 'WRITE ERROR (Write-Verify Error)',
        details: 'A verify pass after write did not match DOS memory. Retrying on another disk helps isolate media versus hardware problems.',
    },
    26: {
        severity: 'WARN',
        message: 'WRITE PROTECT ON',
        details: 'A write was attempted while write-protect is active. Disable protection, if intended, and retry.',
    },
    27: {
        severity: 'ERROR',
        message: 'READ ERROR (Checksum Error In Header)',
        details: 'Header checksum validation failed, so the block header is unreliable. This can come from header damage or line noise.',
    },
    28: {
        severity: 'ERROR',
        message: 'WRITE ERROR (Long Data Block)',
        details: 'The written block overran timing for the next header sync window. Bad formatting, failing media, or hardware timing faults can trigger this.',
    },
    29: {
        severity: 'ERROR',
        message: 'DISK ID MISMATCH',
        details: 'Disk identifier or format metadata does not match what DOS expects. Often seen with uninitialized disks or damaged headers.',
    },
    30: {
        severity: 'ERROR',
        message: 'SYNTAX ERROR (General Syntax)',
        details: 'DOS could not parse the command structure. Verify command shape and argument count.',
    },
    31: {
        severity: 'ERROR',
        message: 'SYNTAX ERROR (Invalid Command)',
        details: 'Command keyword is unknown or in the wrong position. Ensure a valid DOS command starts at character one.',
    },
    32: {
        severity: 'ERROR',
        message: 'SYNTAX ERROR (Long Line)',
        details: 'The command line exceeded DOS length limits. Shorten the command and retry.',
    },
    33: {
        severity: 'ERROR',
        message: 'SYNTAX ERROR (Invalid File Name)',
        details: 'Filename or wildcard usage is invalid for the given operation. Use a valid filename pattern for that command.',
    },
    34: {
        severity: 'ERROR',
        message: 'SYNTAX ERROR (No File Given)',
        details: 'A command expected a filename but none was supplied. Check separators such as ":" and include a target name.',
    },
    39: {
        severity: 'ERROR',
        message: 'SYNTAX ERROR (Invalid Command)',
        details: 'Command channel content could not be resolved by DOS. Check spelling and command-channel syntax.',
    },
    50: {
        severity: 'ERROR',
        message: 'RECORD NOT PRESENT',
        details: 'A relative record read moved beyond end-of-file. Reposition before further INPUT# or GET# operations.',
    },
    51: {
        severity: 'ERROR',
        message: 'OVERFLOW IN RECORD',
        details: 'PRINT# output exceeded the configured record boundary, so trailing data was truncated.',
    },
    52: {
        severity: 'ERROR',
        message: 'FILE TOO LARGE',
        details: 'The relative record position would overflow available disk capacity. Reduce data size or free space.',
    },
    60: {
        severity: 'ERROR',
        message: 'WRITE FILE OPEN',
        details: 'A file still open for writing was accessed for reading. Close the writer handle before reading.',
    },
    61: {
        severity: 'ERROR',
        message: 'FILE NOT OPEN',
        details: 'The requested file or channel is not open in DOS. Open it first, then retry access.',
    },
    62: {
        severity: 'ERROR',
        message: 'FILE NOT FOUND',
        details: 'The requested file does not exist at the selected location.',
    },
    63: {
        severity: 'WARN',
        message: 'FILE EXISTS',
        details: 'Creation target already exists. Use another filename or rename the existing file.',
    },
    64: {
        severity: 'ERROR',
        message: 'FILE TYPE MISMATCH',
        details: 'Requested file type does not match the directory entry type.',
    },
    65: {
        severity: 'ERROR',
        message: 'NO BLOCK',
        details: 'The requested block was already allocated. DOS parameters typically point to the next free candidate block.',
    },
    66: {
        severity: 'ERROR',
        message: 'ILLEGAL TRACK AND SECTOR',
        details: 'Access targeted a track or sector outside the active disk format.',
    },
    67: {
        severity: 'ERROR',
        message: 'ILLEGAL SYSTEM T OR S',
        details: 'DOS attempted to access a reserved system track or sector that is not valid for user data operations.',
    },
    70: {
        severity: 'ERROR',
        message: 'NO CHANNEL (Available)',
        details: 'All DOS channels are in use. Close unused channels or files and retry.',
    },
    71: {
        severity: 'ERROR',
        message: 'DIRECTORY ERROR',
        details: 'Directory allocation bookkeeping is inconsistent (BAM mismatch). Reinitialize to rebuild in-memory allocation state.',
    },
    72: {
        severity: 'WARN',
        message: 'DISK FULL',
        details: 'Disk blocks or directory slots are exhausted. On 1541, DOS may report full slightly early to reserve close-finalization space.',
    },
    73: {
        severity: 'INFO',
        message: 'OK',
        details: 'DOS MISMATCH (power-up status). This is the normal power-on response showing the DOS version. It is not an error, but indicates the drive is ready. If this appears at other times, it may indicate an attempt to write to a disk with an incompatible format.',
    },
    74: {
        severity: 'WARN',
        message: 'DRIVE NOT READY',
        details: 'The drive cannot access media because no disk is ready, present, or seated correctly.',
    },
};

const isUnusedDosCode = (code: number) => {
    return code >= UNUSED_DOS_CODE_MIN && code <= UNUSED_DOS_CODE_MAX;
};

const parseLeadingCode = (rawStatus: string): number | null => {
    const commaIndex = rawStatus.indexOf(',');
    if (commaIndex <= 0) return null;
    const leadingToken = rawStatus.slice(0, commaIndex).trim();
    if (!/^\d+$/.test(leadingToken)) return null;
    return Number(leadingToken);
};

export const formatDiskDosStatus = (rawStatus: string): DiskDosStatus => {
    const code = parseLeadingCode(rawStatus);
    if (code === null) {
        return {
            code: null,
            severity: 'INFO',
            message: null,
            details: null,
            raw: rawStatus,
        };
    }

    if (isUnusedDosCode(code)) {
        return {
            code,
            severity: 'INFO',
            message: null,
            details: 'DOS reserves status codes 2 through 19. They are unused in normal operation and should be ignored.',
            raw: rawStatus,
        };
    }

    const status = DOS_STATUS_BY_CODE[code];
    return {
        code,
        severity: status?.severity ?? 'ERROR',
        message: status?.message ?? null,
        details: status?.details ?? null,
        raw: rawStatus,
    };
};
