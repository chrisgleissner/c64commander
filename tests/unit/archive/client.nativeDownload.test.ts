/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { decodeNativeBinaryData, isUnsupportedSignalError } from "@/lib/archive/client";

describe("archive client native download helpers", () => {
    it("passes ArrayBuffer payloads through unchanged", () => {
        const value = new Uint8Array([0x50, 0x53, 0x49, 0x44]).buffer;

        expect(decodeNativeBinaryData(value)).toBe(value);
    });

    it("extracts the visible bytes from Uint8Array views", () => {
        const value = new Uint8Array([0x00, 0x50, 0x53, 0x49, 0x44, 0xff]).subarray(1, 5);

        expect(new Uint8Array(decodeNativeBinaryData(value))).toEqual(new Uint8Array([0x50, 0x53, 0x49, 0x44]));
    });

    it("converts plain byte arrays into ArrayBuffers", () => {
        const value = [0x50, 0x53, 0x49, 0x44];

        expect(new Uint8Array(decodeNativeBinaryData(value))).toEqual(new Uint8Array(value));
    });

    it("decodes base64-encoded string payloads via atob", () => {
        vi.stubGlobal(
            "atob",
            vi.fn(() => "PSID"),
        );

        try {
            expect(new Uint8Array(decodeNativeBinaryData("UFNJRA=="))).toEqual(new Uint8Array([0x50, 0x53, 0x49, 0x44]));
            expect(globalThis.atob).toHaveBeenCalledWith("UFNJRA==");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("throws on unsupported payload types", () => {
        expect(() => decodeNativeBinaryData(123)).toThrow("unsupported binary payload");
        expect(() => decodeNativeBinaryData(null)).toThrow("unsupported binary payload");
    });

    it("detects AbortSignal runtime compatibility errors", () => {
        expect(
            isUnsupportedSignalError(new Error('Expected signal ("AbortSignal {}") to be an instance of AbortSignal.')),
        ).toBe(true);
        expect(isUnsupportedSignalError(new Error("plain error"))).toBe(false);
        expect(isUnsupportedSignalError("plain error")).toBe(false);
    });
});
