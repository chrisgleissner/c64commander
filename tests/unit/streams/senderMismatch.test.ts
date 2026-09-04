/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { describeSenderAdoption, describeSenderMismatch, detectSenderMismatch } from "@/lib/streams/senderMismatch";

describe("detectSenderMismatch", () => {
  it("names the address the packets came from and the address the app expected", () => {
    const mismatch = detectSenderMismatch(
      { rejectedPackets: 4210, lastRejectedSource: "192.168.1.148", expectedSource: "192.168.1.9" },
      "192.168.1.9",
    );
    expect(mismatch).toEqual({ source: "192.168.1.148", expected: "192.168.1.9", rejectedPackets: 4210 });
  });

  it("falls back to the resolved filter address when the saved host is not known", () => {
    const mismatch = detectSenderMismatch(
      { rejectedPackets: 12, lastRejectedSource: "192.168.1.148", expectedSource: "192.168.1.9" },
      null,
    );
    expect(mismatch?.expected).toBe("192.168.1.9");
  });

  it("reports nothing when the filter refused nothing", () => {
    expect(detectSenderMismatch({ rejectedPackets: 0, expectedSource: "192.168.1.9" }, "c64u")).toBeNull();
  });

  it("reports nothing when the plugin could not answer", () => {
    expect(detectSenderMismatch(null, "c64u")).toBeNull();
  });

  it("reports nothing when the refused address is the one the app is already accepting", () => {
    // The count is historical — the filter was retargeted after those packets were dropped — so it
    // cannot explain silence now, and offering to adopt the address already in use would be a
    // recovery that changes nothing.
    expect(
      detectSenderMismatch(
        { rejectedPackets: 30, lastRejectedSource: "192.168.1.148", expectedSource: "192.168.1.148" },
        "192.168.1.148",
      ),
    ).toBeNull();
  });
});

describe("describeSenderMismatch", () => {
  it("says where the packets are coming from rather than that the stream stopped", () => {
    const mismatch = { source: "192.168.1.148", expected: "c64u", rejectedPackets: 900 };
    expect(describeSenderMismatch(mismatch, "video")).toBe(
      "Video packets are arriving from 192.168.1.148 and being dropped — the app is only accepting packets from c64u.",
    );
    expect(describeSenderMismatch(mismatch, "audio")).toMatch(/^Audio packets are arriving from 192\.168\.1\.148/);
  });

  it("still names the sender when the expected address is unknown", () => {
    expect(describeSenderMismatch({ source: "10.0.0.4", expected: null, rejectedPackets: 5 }, "video")).toBe(
      "Video packets are arriving from 10.0.0.4 and being dropped.",
    );
  });
});

describe("describeSenderAdoption", () => {
  it("labels the recovery with the address it will accept", () => {
    expect(describeSenderAdoption({ source: "192.168.1.148", expected: "c64u", rejectedPackets: 1 })).toBe(
      "Use 192.168.1.148",
    );
  });
});
