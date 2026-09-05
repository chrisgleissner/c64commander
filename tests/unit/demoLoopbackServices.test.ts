/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";
import { clearRuntimeArchiveOverride, setRuntimeArchiveOverride } from "@/lib/archive/demoOverride";
import { clearRuntimeHvscBaseUrl, getHvscBaseUrl, setRuntimeHvscBaseUrl } from "@/lib/hvsc/hvscReleaseService";

/*
 * Demo Mode serves the online archive and HVSC from this device, and both redirections are
 * session state rather than settings. These cover the two properties that made the difference
 * between a demo that works offline and one that does not:
 *
 *   - while it is running, the mock wins over the user's own host, and
 *   - when it stops, the user's own host is exactly what it was.
 */
describe("the services Demo Mode redirects to its own device", () => {
  afterEach(() => {
    clearRuntimeArchiveOverride();
    clearRuntimeHvscBaseUrl();
    localStorage.clear();
  });

  it("points the archive at the mock, with the token the loopback servers require", () => {
    setRuntimeArchiveOverride({ host: "127.0.0.1:41955", token: "per-boot-token" });

    const config = buildDefaultArchiveClientConfig();

    expect(config.baseUrl).toBe("http://127.0.0.1:41955");
    expect(config.headers?.["X-Mock-Token"]).toBe("per-boot-token");
  });

  it("wins over a host the user has set, without overwriting it", () => {
    const userConfig = buildDefaultArchiveClientConfig({ hostOverride: "archive.example.test" });
    expect(userConfig.baseUrl).toBe("http://archive.example.test");

    setRuntimeArchiveOverride({ host: "127.0.0.1:41955", token: null });
    expect(buildDefaultArchiveClientConfig({ hostOverride: "archive.example.test" }).baseUrl).toBe(
      "http://127.0.0.1:41955",
    );

    // Leaving Demo Mode restores the user's own archive, because it was never written over.
    clearRuntimeArchiveOverride();
    expect(buildDefaultArchiveClientConfig({ hostOverride: "archive.example.test" }).baseUrl).toBe(
      "http://archive.example.test",
    );
  });

  it("sends no mock token when there is none to send", () => {
    setRuntimeArchiveOverride({ host: "127.0.0.1:41955", token: null });
    expect(buildDefaultArchiveClientConfig().headers?.["X-Mock-Token"]).toBeUndefined();
  });

  it("resolves HVSC to the demo release for every caller, not only the public getter", () => {
    setRuntimeHvscBaseUrl("http://127.0.0.1:41955/hvsc/per-boot-token/");
    expect(getHvscBaseUrl()).toBe("http://127.0.0.1:41955/hvsc/per-boot-token/");
  });

  it("wins over a stored HVSC base URL, and leaves it in place", () => {
    localStorage.setItem("c64u_hvsc_base_url", "https://hvsc.example.test/HVSC/");
    expect(getHvscBaseUrl()).toBe("https://hvsc.example.test/HVSC/");

    setRuntimeHvscBaseUrl("http://127.0.0.1:41955/hvsc/per-boot-token/");
    expect(getHvscBaseUrl()).toBe("http://127.0.0.1:41955/hvsc/per-boot-token/");

    clearRuntimeHvscBaseUrl();
    expect(getHvscBaseUrl()).toBe("https://hvsc.example.test/HVSC/");
  });
});
