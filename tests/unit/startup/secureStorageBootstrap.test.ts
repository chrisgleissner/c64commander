/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { primeSecureStorageAfterStartup } from "@/lib/startup/secureStorageBootstrap";
import { primeStoredPassword } from "@/lib/secureStorage";

vi.mock("@/lib/secureStorage", () => ({
  primeStoredPassword: vi.fn(async () => undefined),
}));

describe("secureStorageBootstrap", () => {
  it("primes secure storage through the normal password cache path", async () => {
    await primeSecureStorageAfterStartup();

    expect(primeStoredPassword).toHaveBeenCalledOnce();
  });
});
