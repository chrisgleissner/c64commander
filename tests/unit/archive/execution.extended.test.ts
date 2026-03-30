/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { FILE_TYPE_TO_EXTENSION, buildArchivePlayPlan, getArchiveEntryActionLabel } from "@/lib/archive/execution";

const createBinary = (fileName: string, bytes: Uint8Array) => ({
    fileName,
    bytes,
    contentType: "application/octet-stream",
    url: `http://archive.local/${fileName || "download"}`,
});

const createSidBytes = () => {
    const bytes = new Uint8Array(0x78);
    bytes.set([0x50, 0x53, 0x49, 0x44], 0);
    bytes.set([0x00, 0x02], 4);
    bytes.set([0x00, 0x76], 6);
    bytes.set([0x00, 0x01], 0x0e);
    bytes.set([0x00, 0x01], 0x10);
    return bytes;
};

describe("archive execution extended", () => {
    it("adds a sid extension for extensionless SID payloads", () => {
        const plan = buildArchivePlayPlan(createBinary("demo", createSidBytes()));

        expect(plan).toMatchObject({ category: "sid", path: "demo.sid" });
    });

    it("adds a d64 extension for extensionless disk payloads", () => {
        const plan = buildArchivePlayPlan(createBinary("diskdemo", new Uint8Array(174848)));

        expect(plan).toMatchObject({ category: "disk", path: "diskdemo.d64", mountType: "d64" });
    });

    it("throws when detected file bytes fail validation", () => {
        const corruptSid = createSidBytes();
        corruptSid[6] = 0xff;
        corruptSid[7] = 0xff;

        expect(() => buildArchivePlayPlan(createBinary("broken", corruptSid))).toThrow(
            "Unsupported archive file broken: invalid data offset",
        );
    });

    it("throws for unsupported file types", () => {
        expect(() => buildArchivePlayPlan(createBinary("notes.bin", new Uint8Array([0xde, 0xad, 0xbe, 0xef])))).toThrow(
            "Unsupported archive file notes.bin",
        );
    });

    it("returns user-facing action labels for known and unknown archive entries", () => {
        expect(getArchiveEntryActionLabel("tune.sid")).toBe("Play");
        expect(getArchiveEntryActionLabel("disk.d64")).toBe("Mount & run");
        expect(getArchiveEntryActionLabel("demo.prg")).toBe("Run");
        expect(getArchiveEntryActionLabel("notes.txt")).toBe("Execute");
    });

    it("covers every file type extension mapping entry", () => {
        const expectations: Record<string, { category: string; path: string; mountType?: string }> = {
            crt: { category: "crt", path: "archive.crt" },
            d64: { category: "disk", path: "archive.d64", mountType: "d64" },
            d71: { category: "disk", path: "archive.d71", mountType: "d71" },
            d81: { category: "disk", path: "archive.d81", mountType: "d81" },
            mod: { category: "mod", path: "archive.mod" },
            prg: { category: "prg", path: "archive.prg" },
            sid: { category: "sid", path: "archive.sid" },
        };

        expect(Object.keys(FILE_TYPE_TO_EXTENSION).sort()).toEqual(Object.keys(expectations).sort());

        for (const [type, extension] of Object.entries(FILE_TYPE_TO_EXTENSION)) {
            const resolved = buildArchivePlayPlan(createBinary(`archive.${extension}`, createBytesForType(type)));
            expect(resolved).toMatchObject(expectations[extension]);
        }
    });
});

function createBytesForType(type: string): Uint8Array {
    switch (type) {
        case "sid":
            return createSidBytes();
        case "d64":
            return new Uint8Array(174848);
        case "d71":
            return new Uint8Array(349696);
        case "d81":
            return new Uint8Array(819200);
        case "mod": {
            const bytes = new Uint8Array(1084);
            bytes.set([0x4d, 0x2e, 0x4b, 0x2e], 1080);
            return bytes;
        }
        case "crt": {
            const bytes = new Uint8Array(80);
            bytes.set(new TextEncoder().encode("C64 CARTRIDGE   "), 0);
            bytes.set([0x00, 0x00, 0x00, 0x40], 16);
            bytes.set([0x01, 0x00], 20);
            bytes.set(new TextEncoder().encode("CHIP"), 64);
            bytes.set([0x00, 0x00, 0x00, 0x10], 68);
            return bytes;
        }
        case "prg":
            return new Uint8Array([0x01, 0x08, 0x60]);
        default:
            throw new Error(`Unsupported fixture type ${type}`);
    }
}
