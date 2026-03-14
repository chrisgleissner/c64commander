import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getDiagnosticsColorClassForDisplaySeverity } from "@/lib/diagnostics/diagnosticsSeverity";
import {
  DRIVE_DEFAULT_BUS_ID,
  DRIVE_DEFAULT_TYPE,
  LocationIcon,
  buildDriveLabel,
  buildDrivePath,
  formatBytes,
  formatDate,
  getCategoryConfigValue,
  getStatusMessageColorClass,
  parseBusId,
  parseDriveType,
  resolveDriveBusId,
  resolveDriveStatusRaw,
  resolveDriveType,
  resolveSoftIecDefaultPath,
  resolveSoftIecServiceError,
  resolveStatusDisplaySeverity,
} from "@/components/disks/HomeDiskManagerSupport";

describe("HomeDiskManagerSupport", () => {
  it("builds drive labels and paths", () => {
    expect(buildDriveLabel("a")).toBe("Drive A");
    expect(buildDrivePath("/USB0", "disk.d64")).toBe("/USB0/disk.d64");
    expect(buildDrivePath("/USB0/", "disk.d64")).toBe("/USB0/disk.d64");
    expect(buildDrivePath("/USB0", null)).toBeNull();
  });

  it("renders the location icon for local and ultimate disks", () => {
    const { rerender } = render(<LocationIcon location="local" />);
    expect(screen.getByLabelText("Local disk")).toBeInTheDocument();

    rerender(<LocationIcon location="ultimate" />);
    expect(screen.getByLabelText("C64U disk")).toBeInTheDocument();
  });

  it("formats bytes and dates defensively", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDate("2024-04-12T00:00:00.000Z")).toContain("2024");
  });

  it("resolves soft IEC and drive status messages", () => {
    expect(resolveSoftIecServiceError("service error reported.")).toBe("");
    expect(resolveSoftIecServiceError(" permission denied ")).toBe("permission denied");
    expect(resolveDriveStatusRaw("00, OK,00,00", "fallback")).toBe("00, OK,00,00");
    expect(resolveDriveStatusRaw("", "fallback")).toBe("fallback");
    expect(resolveDriveStatusRaw(undefined, undefined)).toBe("");
  });

  it("extracts config values and parses bus ids and drive types", () => {
    const payload = {
      "Drive A Settings": {
        items: {
          "Drive Bus ID": "10",
          "Drive Type": "1571",
        },
      },
      direct: {
        value: true,
      },
    };

    expect(getCategoryConfigValue(payload, "Drive A Settings", "Drive Bus ID")).toBe("10");
    expect(getCategoryConfigValue(payload, "direct", "value")).toBe(true);
    expect(getCategoryConfigValue(payload, "missing", "value")).toBeUndefined();
    expect(parseBusId("11")).toBe(11);
    expect(parseBusId("abc")).toBeNull();
    expect(parseDriveType(" 1581 ")).toBe("1581");
    expect(parseDriveType("   ")).toBeNull();
  });

  it("resolves drive config defaults from config, fallback info, and hard defaults", () => {
    const payload = {
      "Drive A Settings": {
        items: {
          "Drive Bus ID": "10",
          "Drive Type": "1571",
        },
      },
      "SoftIEC Drive Settings": {
        items: {
          "Default Path": "/Games",
        },
      },
    };

    expect(resolveDriveBusId("a", payload, { bus_id: 9 })).toBe(10);
    expect(resolveDriveBusId("b", {}, { bus_id: 11 })).toBe(11);
    expect(resolveDriveBusId("b", {}, undefined)).toBe(DRIVE_DEFAULT_BUS_ID.b);

    expect(resolveDriveType("a", payload, { type: "1541" })).toBe("1571");
    expect(resolveDriveType("b", {}, { type: "1581" })).toBe("1581");
    expect(resolveDriveType("b", {}, undefined)).toBe(DRIVE_DEFAULT_TYPE);

    expect(resolveSoftIecDefaultPath(payload, "/Fallback")).toBe("/Games/");
    expect(resolveSoftIecDefaultPath({}, "/Fallback")).toBe("/Fallback/");
    expect(resolveSoftIecDefaultPath({}, null)).toBe("/USB0/");
  });

  it("maps display severity and status colors", () => {
    const okStatus = { severity: "WARN" as const, message: "OK" };
    const warningStatus = { severity: "WARN" as const, message: "Drive warming up" };

    expect(resolveStatusDisplaySeverity(okStatus)).toBe("WARN");
    expect(getStatusMessageColorClass(okStatus)).toBe("text-success");
    expect(getStatusMessageColorClass(warningStatus)).toBe(getDiagnosticsColorClassForDisplaySeverity("WARN"));
  });
});
