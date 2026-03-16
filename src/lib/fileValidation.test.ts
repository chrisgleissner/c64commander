import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
    toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
    addErrorLog: vi.fn(),
}));

import { toast } from "@/hooks/use-toast";
import { addErrorLog } from "@/lib/logging";
import {
    FILE_VALIDATION_FAILED_EVENT,
    FileValidationError,
    TransmissionGuard,
    reportFileValidationFailure,
    validateFileBytes,
} from "@/lib/fileValidation";

const ascii = (value: string) => new TextEncoder().encode(value);

const setBE16 = (bytes: Uint8Array, offset: number, value: number) => {
    bytes[offset] = (value >> 8) & 0xff;
    bytes[offset + 1] = value & 0xff;
};

const setBE32 = (bytes: Uint8Array, offset: number, value: number) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
};

const createValidSid = () => {
    const bytes = new Uint8Array(0x77);
    bytes.set(ascii("PSID"), 0);
    setBE16(bytes, 4, 2);
    setBE16(bytes, 6, 0x76);
    setBE16(bytes, 14, 1);
    setBE16(bytes, 16, 1);
    bytes[0x76] = 0x60;
    return bytes;
};

const createValidMod = () => {
    const bytes = new Uint8Array(1084);
    bytes.set(ascii("M.K."), 1080);
    return bytes;
};

const createValidCrt = (version: number = 0x0100) => {
    const bytes = new Uint8Array(80);
    bytes.set(ascii("C64 CARTRIDGE   "), 0);
    setBE32(bytes, 16, 64);
    setBE16(bytes, 20, version);
    bytes.set(ascii("CHIP"), 64);
    setBE32(bytes, 68, 16);
    return bytes;
};

const createRandomBytes = (size: number, seed: number) => {
    let value = seed;
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
        value = (value * 1103515245 + 12345) & 0x7fffffff;
        bytes[index] = value & 0xff;
    }
    return bytes;
};

describe("fileValidation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("accepts valid samples for all supported file types", () => {
        expect(validateFileBytes(new Uint8Array(174848), "d64")).toMatchObject({ ok: true, detectedType: "d64" });
        expect(validateFileBytes(new Uint8Array(349696), "d71")).toMatchObject({ ok: true, detectedType: "d71" });
        expect(validateFileBytes(new Uint8Array(819200), "d81")).toMatchObject({ ok: true, detectedType: "d81" });
        expect(validateFileBytes(Uint8Array.from([0x01, 0x08, 0x60]), "prg")).toMatchObject({
            ok: true,
            detectedType: "prg",
        });
        expect(validateFileBytes(createValidSid(), "sid")).toMatchObject({ ok: true, detectedType: "sid" });
        expect(validateFileBytes(createValidMod(), "mod")).toMatchObject({ ok: true, detectedType: "mod" });
        expect(validateFileBytes(createValidCrt(), "crt")).toMatchObject({ ok: true, detectedType: "crt" });
    });

    it("accepts all supported CRT header versions", () => {
        expect(validateFileBytes(createValidCrt(0x0100), "crt")).toMatchObject({ ok: true, detectedType: "crt" });
        expect(validateFileBytes(createValidCrt(0x0101), "crt")).toMatchObject({ ok: true, detectedType: "crt" });
        expect(validateFileBytes(createValidCrt(0x0200), "crt")).toMatchObject({ ok: true, detectedType: "crt" });
    });

    it("rejects truncated, malformed, and structurally invalid files", () => {
        expect(validateFileBytes(new Uint8Array(10), "d64")).toMatchObject({ ok: false, code: "INVALID_SIZE" });

        const badPrg = Uint8Array.from([0x01, 0x08]);
        expect(validateFileBytes(badPrg, "prg")).toMatchObject({ ok: false, code: "INVALID_PROGRAM_DATA" });

        const badSid = createValidSid();
        badSid.set(ascii("NOPE"), 0);
        expect(validateFileBytes(badSid, "sid")).toMatchObject({ ok: false, code: "INVALID_MAGIC" });

        const badSongRange = createValidSid();
        setBE16(badSongRange, 14, 1);
        setBE16(badSongRange, 16, 2);
        expect(validateFileBytes(badSongRange, "sid")).toMatchObject({ ok: false, code: "INVALID_SONG_RANGE" });

        const badMod = createValidMod();
        badMod[952] = 128;
        expect(validateFileBytes(badMod, "mod")).toMatchObject({ ok: false, code: "INVALID_PATTERN_TABLE" });

        const badCrtMagic = createValidCrt();
        badCrtMagic[0] = 0x00;
        expect(validateFileBytes(badCrtMagic, "crt")).toMatchObject({ ok: false, code: "INVALID_MAGIC" });

        const badChipHeader = createValidCrt();
        badChipHeader.set(ascii("BORK"), 64);
        expect(validateFileBytes(badChipHeader, "crt")).toMatchObject({ ok: false, code: "INVALID_CHIP_HEADER" });

        const badChipLength = createValidCrt();
        setBE32(badChipLength, 68, 15);
        expect(validateFileBytes(badChipLength, "crt")).toMatchObject({ ok: false, code: "INVALID_CHIP_PACKET" });
    });

    it("detects strong type mismatches instead of trusting the requested upload type", () => {
        const result = validateFileBytes(createValidCrt(), "prg");

        expect(result).toMatchObject({
            ok: false,
            code: "INVALID_FILE_TYPE",
            detectedType: "crt",
        });
    });

    it("rejects unsupported uploads when no type can be determined", () => {
        const result = validateFileBytes(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));

        expect(result).toMatchObject({
            ok: false,
            code: "UNSUPPORTED_FILE_TYPE",
            detectedType: "unknown",
        });
    });

    it("reports validation failures exactly once", () => {
        const error = new FileValidationError(
            {
                filename: "/games/Broken.crt",
                operation: "CRT_RUN_UPLOAD",
                endpoint: "/v1/runners:run_crt",
                expectedType: "crt",
            },
            {
                ok: false,
                code: "INVALID_CHIP_HEADER",
                detectedType: "crt",
                reason: "invalid CHIP header",
            },
        );

        reportFileValidationFailure(error);
        reportFileValidationFailure(error);

        expect(addErrorLog).toHaveBeenCalledTimes(1);
        expect(addErrorLog).toHaveBeenCalledWith(FILE_VALIDATION_FAILED_EVENT, expect.objectContaining({
            eventType: FILE_VALIDATION_FAILED_EVENT,
            filename: "Broken.crt",
            validationCode: "INVALID_CHIP_HEADER",
        }));
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({
            title: "Upload blocked",
            description: expect.stringContaining("Broken.crt is structurally invalid (invalid CHIP header)."),
            variant: "destructive",
        }));
    });

    it("safely rejects fuzzed CRT and SID inputs without crashing", () => {
        for (let seed = 1; seed <= 50; seed += 1) {
            const crtResult = validateFileBytes(createRandomBytes(32 + seed, seed), "crt");
            const sidResult = validateFileBytes(createRandomBytes(12 + seed, seed * 3), "sid");

            expect(crtResult.ok).toBe(false);
            expect(sidResult.ok).toBe(false);
        }
    });

    it("throws a handled validation error from the transmission guard", () => {
        expect(() =>
            TransmissionGuard.validateOrThrow(new Uint8Array(10), {
                filename: "broken.d64",
                operation: "DRIVE_MOUNT_UPLOAD",
                endpoint: "/v1/drives/a:mount",
                expectedType: "d64",
            }),
        ).toThrowError(/Transmission to C64U was aborted/);

        expect(toast).toHaveBeenCalledTimes(1);
        expect(addErrorLog).toHaveBeenCalledTimes(1);
    });
});
