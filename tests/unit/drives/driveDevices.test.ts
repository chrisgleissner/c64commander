/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildBusIdOptions,
  buildTypeOptions,
  normalizeDriveDevices,
} from "@/lib/drives/driveDevices";

describe("drive device normalization", () => {
  it("classifies and orders known device classes", () => {
    const result = normalizeDriveDevices({
      drives: [
        { "Printer Emulation": { enabled: false, bus_id: 4 } },
        { b: { enabled: false, bus_id: 9, type: "1541" } },
        { "IEC Drive": { enabled: true, bus_id: 11, type: "DOS emulation" } },
        { a: { enabled: true, bus_id: 8, type: "1571" } },
      ],
    });

    expect(result.devices.map((entry) => entry.class)).toEqual([
      "PHYSICAL_DRIVE_A",
      "PHYSICAL_DRIVE_B",
      "SOFT_IEC_DRIVE",
      "PRINTER",
    ]);
    expect(result.devices.map((entry) => entry.label)).toEqual([
      "Drive A",
      "Drive B",
      "Soft IEC Drive",
      "Printer",
    ]);
  });

  it("tolerates unknown devices and missing optional fields", () => {
    const result = normalizeDriveDevices({
      drives: [
        { a: { enabled: true, bus_id: 8 } },
        { UnknownDevice: { enabled: false, bus_id: 15, type: "mystery" } },
      ],
    });

    expect(result.devices).toHaveLength(1);
    expect(result.unknownDevices).toHaveLength(1);
    expect(result.devices[0]?.type).toBeNull();
  });

  it("reflects refreshed soft IEC transient error state without optimistic clearing", () => {
    const beforeReset = normalizeDriveDevices({
      drives: [
        {
          "IEC Drive": {
            enabled: false,
            bus_id: 11,
            type: "DOS emulation",
            last_error: "73,U64IEC ULTIMATE DOS V1.1,00,00",
          },
        },
      ],
    });
    const afterReset = normalizeDriveDevices({
      drives: [
        {
          "IEC Drive": {
            enabled: false,
            bus_id: 11,
            type: "DOS emulation",
          },
        },
      ],
    });

    expect(beforeReset.devices[0]?.lastError).toContain("73,U64IEC");
    expect(afterReset.devices[0]?.lastError).toBeNull();
  });

  it("keeps current values in dropdown option builders", () => {
    expect(buildBusIdOptions([8, 9, 10, 11], 15)).toContain("15");
    expect(buildTypeOptions(["1541", "1571", "1581"], "custom")).toContain(
      "custom",
    );
  });

  it("handles null payload gracefully (BRDA:119)", () => {
    const result = normalizeDriveDevices(null);
    expect(result.devices).toHaveLength(0);
    expect(result.unknownDevices).toHaveLength(0);
  });

  it("skips non-object entries in drives array (BRDA:121)", () => {
    const result = normalizeDriveDevices({
      drives: [
        null as any,
        "not an object" as any,
        { a: { enabled: true, bus_id: 8 } },
      ],
    });
    expect(result.devices).toHaveLength(1);
  });

  it("skips non-object rawValue in drive entry (BRDA:123)", () => {
    const result = normalizeDriveDevices({
      drives: [
        { a: null as any },
        { b: "not-object" as any },
        { "IEC Drive": { enabled: true } },
      ],
    });
    expect(result.devices).toHaveLength(1);
  });

  it("ignores duplicate device class entries (BRDA:132)", () => {
    const result = normalizeDriveDevices({
      drives: [
        { a: { enabled: true, bus_id: 8, type: "1541" } },
        { a: { enabled: false, bus_id: 9, type: "1571" } },
      ],
    });
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.busId).toBe(8);
  });

  it("normalizes valid partitions array (BRDA:86)", () => {
    const result = normalizeDriveDevices({
      drives: [
        {
          a: {
            enabled: true,
            bus_id: 8,
            partitions: [
              { id: 1, path: "/part1" },
              { id: 2, path: "/part2" },
              null as any,
              { id: "bad", path: "/bad" } as any,
            ],
          },
        },
      ],
    });
    expect(result.devices[0]?.partitions).toHaveLength(2);
    expect(result.devices[0]?.partitions[0]).toEqual({ id: 1, path: "/part1" });
  });

  it("captures optional rom, imageFile, imagePath fields (BRDA:105)", () => {
    const result = normalizeDriveDevices({
      drives: [
        {
          a: {
            enabled: true,
            bus_id: 8,
            type: "1541",
            rom: "original-1541",
            image_file: "disk.d64",
            image_path: "/mnt/disk.d64",
          },
        },
      ],
    });
    expect(result.devices[0]?.rom).toBe("original-1541");
    expect(result.devices[0]?.imageFile).toBe("disk.d64");
    expect(result.devices[0]?.imagePath).toBe("/mnt/disk.d64");
  });

  it('resolves printer endpointKey to "printer" for multi-word apiKey (BRDA:81)', () => {
    // 'Printer Emulation' has a space so fails the alphanumeric regex.
    // resolveEndpointKey then falls through to the PRINTER branch at line 81.
    const result = normalizeDriveDevices({
      drives: [{ "Printer Emulation": { enabled: true, bus_id: 4 } }],
    });
    expect(result.devices[0]?.endpointKey).toBe("printer");
  });

  it('resolves soft IEC endpointKey to "softiec" for multi-word apiKey (BRDA:80)', () => {
    // 'IEC Drive' also fails the alphanumeric regex, exercising the SOFT_IEC_DRIVE branch.
    const result = normalizeDriveDevices({
      drives: [{ "IEC Drive": { enabled: true, bus_id: 11 } }],
    });
    expect(result.devices[0]?.endpointKey).toBe("softiec");
  });
});
