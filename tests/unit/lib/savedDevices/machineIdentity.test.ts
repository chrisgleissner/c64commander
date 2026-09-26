/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isSameMachine, machineIdentityKey, savedEntryMachineIdentity } from "@/lib/savedDevices/machineIdentity";
import type { SavedDevice } from "@/lib/savedDevices/store";

const entry = (id: string, lastKnownUniqueId: string | null, lastKnownHostname: string | null): SavedDevice => ({
  id,
  name: id,
  host: "192.0.2.10",
  httpPort: 80,
  ftpPort: 21,
  telnetPort: 23,
  lastKnownProduct: "U64E",
  lastKnownHostname,
  lastKnownUniqueId,
  lastSuccessfulConnectionAt: null,
  lastUsedAt: null,
  hasPassword: false,
});

describe("machine identity", () => {
  it("names a machine only when both its unique id and its hostname are known, ignoring case and spaces", () => {
    expect(machineIdentityKey({ uniqueId: " ABC123 ", hostname: "Ultimate-64-A1B2C3" })).toBe(
      machineIdentityKey({ uniqueId: "abc123", hostname: "ultimate-64-a1b2c3 " }),
    );
    expect(machineIdentityKey({ uniqueId: "ABC123", hostname: null })).toBeNull();
    expect(machineIdentityKey({ uniqueId: "  ", hostname: "ultimate" })).toBeNull();
  });

  it("does not treat two devices that share a custom unique id but not a hostname as one machine", () => {
    expect(
      isSameMachine({ uniqueId: "MY-ULTIMATE", hostname: "desk" }, { uniqueId: "my-ultimate", hostname: "DESK" }),
    ).toBe(true);
    expect(
      isSameMachine({ uniqueId: "MY-ULTIMATE", hostname: "desk" }, { uniqueId: "MY-ULTIMATE", hostname: "attic" }),
    ).toBe(false);
    expect(
      isSameMachine({ uniqueId: "MY-ULTIMATE", hostname: null }, { uniqueId: "MY-ULTIMATE", hostname: null }),
    ).toBe(false);
  });

  it("reads a saved entry's verified identity before the one stored with it", () => {
    const snapshot = {
      devices: [entry("verified", "STORED", "stored-host"), entry("stored", "STORED", "stored-host")],
      verifiedByDeviceId: { verified: { product: null, uniqueId: "VERIFIED", hostname: "verified-host" } },
    };

    expect(savedEntryMachineIdentity(snapshot, "verified")).toEqual({
      uniqueId: "VERIFIED",
      hostname: "verified-host",
    });
    expect(savedEntryMachineIdentity(snapshot, "stored")).toEqual({ uniqueId: "STORED", hostname: "stored-host" });
    expect(savedEntryMachineIdentity(snapshot, "missing")).toEqual({ uniqueId: null, hostname: null });
  });
});
