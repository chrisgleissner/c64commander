/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { KEY_SELECTED_ATTRIBUTE as SELECTED, enableKeypad } from "./focusRing";

/**
 * The device switcher's health detail, on the smallest screen, with a second saved device that
 * accepts connections and never answers them.
 *
 * That second device is what made the reachable one look degraded: every REST request shared one
 * slot, so the silent device held it until its timeout while the reachable device's RASTER and
 * JIFFY reads timed out in the app's own queue. The device-safety governor is forced on, because
 * automated builds otherwise run without it and the slot would not exist.
 */

const MIN_TARGET_PX = 44;
const MIN_TEXT_PX = 14;
const MIN_BODY_TEXT_PX = 16;

const startSilentDevice = async () => {
  const sockets = new Set<Socket>();
  const server: Server = createServer(() => {});
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Silent device did not bind a TCP port");
  return {
    port: address.port,
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const savedDevice = (id: string, name: string, host: string, httpPort: number) => ({
  id,
  name,
  nameSource: "custom",
  host,
  httpPort,
  ftpPort: 21,
  telnetPort: 23,
  lastKnownProduct: "C64U",
  lastKnownHostname: id,
  lastKnownUniqueId: `UID-${id}`,
  lastSuccessfulConnectionAt: null,
  lastUsedAt: null,
  hasPassword: false,
});

const openSwitcher = async (page: Page) => {
  const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await badge.dispatchEvent("pointerdown");
  await page.waitForTimeout(700);
  await badge.dispatchEvent("pointerup");
  const sheet = page.getByTestId("switch-device-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
};

const probeRow = (sheet: Locator, probe: string) =>
  sheet.getByTestId("health-check-detail-view").getByTestId(`health-check-probe-${probe}`);

const fontSizeOf = (locator: Locator) =>
  locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

test.describe("Switch device health detail on a 320x427 screen", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let silentDevice: Awaited<ReturnType<typeof startSilentDevice>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Health detail coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    silentDevice = await startSilentDevice();
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    const reachable = new URL(server.baseUrl);
    await page.addInitScript(
      ({ devices }) => {
        (window as Window & { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
        localStorage.setItem("c64u_display_profile_override", "compact");
        localStorage.setItem(
          "c64u_saved_devices:v1",
          JSON.stringify({
            version: 1,
            selectedDeviceId: "device-reachable",
            devices,
            summaries: {},
            summaryLru: [],
            hasEverHadMultipleDevices: true,
          }),
        );
      },
      {
        devices: [
          savedDevice("device-reachable", "Living room C64", reachable.hostname, Number(reachable.port)),
          // `localhost` rather than 127.0.0.1: the REST slot is per host name, and both servers share an address.
          savedDevice("device-silent", "Workshop C64", "localhost", silentDevice.port),
        ],
      },
    );
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await silentDevice.close();
    await server.close();
  });

  test("checks the reachable device in full while another saved device does not answer", async ({ page }) => {
    test.setTimeout(90_000);
    // Network order, not durations: on a loaded machine this device's own startup traffic can slow its probes,
    // but its readmem request must still go out while the silent device's info request is pending.
    const events: string[] = [];
    const isSilentInfo = (url: string) => url.startsWith(`http://localhost:${silentDevice.port}/v1/info`);
    page.on("request", (request) => {
      if (isSilentInfo(request.url())) events.push("silent-info-sent");
      if (request.url().includes("/v1/machine:readmem")) events.push("reachable-readmem-sent");
    });
    page.on("requestfailed", (request) => {
      if (isSilentInfo(request.url())) events.push("silent-info-failed");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sheet = await openSwitcher(page);
    await sheet.getByTestId("switch-device-expand-device-reachable").click();

    for (const probe of ["rest", "raster", "jiffy"]) {
      await expect(probeRow(sheet, probe), `${probe} on the reachable device`).toContainText("Success", {
        timeout: 30_000,
      });
    }
    await expect(sheet.getByTestId("switch-device-status-device-silent")).not.toContainText("Healthy");

    const firstSilentInfo = events.indexOf("silent-info-sent");
    expect(firstSilentInfo, events.join(", ")).toBeGreaterThanOrEqual(0);
    const settledAt = events.indexOf("silent-info-failed", firstSilentInfo);
    const readMemoryAt = events.indexOf("reachable-readmem-sent", firstSilentInfo);
    expect(readMemoryAt, events.join(", ")).toBeGreaterThan(firstSilentInfo);
    if (settledAt !== -1) expect(readMemoryAt, events.join(", ")).toBeLessThan(settledAt);
  });

  test("each saved device card states its status once, with its badge beside the name, without cutting anything off @layout", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sheet = await openSwitcher(page);
    for (const id of ["device-reachable", "device-silent"]) {
      const row = sheet.getByTestId(`switch-device-row-${id}`);
      const badge = sheet.getByTestId(`switch-device-status-${id}`);
      const measured = await row.evaluate((element) => {
        const clipped = Array.from(element.querySelectorAll("*")).filter(
          (node) => node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0,
        );
        const pill = element.querySelector(".rounded-full.border");
        return { height: element.getBoundingClientRect().height, clipped: clipped.length, pill: pill !== null };
      });
      expect(measured.clipped, `${id}: nothing in the card is cut off`).toBe(0);
      expect(measured.pill, `${id}: no separate status pill`).toBe(false);
      expect(measured.height, `${id}: card height`).toBeLessThanOrEqual(110);
      const [rowBox, badgeBox] = await Promise.all([row.boundingBox(), badge.boundingBox()]);
      expect(badgeBox!.y - rowBox!.y, `${id}: the badge sits beside the name or directly under it`).toBeLessThan(70);
    }
  });

  test("explains skipped checks behind a 44 px info button instead of repeating technical text", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sheet = await openSwitcher(page);
    await sheet.getByTestId("switch-device-expand-device-reachable").click();

    const telnet = probeRow(sheet, "telnet");
    await expect(telnet).toContainText("Skipped", { timeout: 30_000 });
    await expect(sheet).not.toContainText("does not probe Telnet");
    await expect(sheet).not.toContainText("health check is read-only");

    const info = telnet.getByRole("button", { name: "Why was Telnet skipped?" });
    await expect(info).toBeVisible();
    const box = await info.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(await fontSizeOf(telnet.getByText("Skipped", { exact: true }))).toBeGreaterThanOrEqual(MIN_TEXT_PX);

    await info.click();
    const explanation = page.getByTestId("health-check-probe-info-telnet-explanation");
    await expect(explanation).toBeVisible();
    await expect(explanation).toHaveText(
      "Not checked here, so this list doesn't open extra connections to your C64. To check it, open the status badge and choose Run health check.",
    );
    expect(await fontSizeOf(explanation.locator("p"))).toBeGreaterThanOrEqual(MIN_BODY_TEXT_PX);
    const explanationBox = await explanation.boundingBox();
    const viewport = page.viewportSize();
    expect(explanationBox!.x).toBeGreaterThanOrEqual(0);
    expect(explanationBox!.x + explanationBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(explanationBox!.y + explanationBox!.height).toBeLessThanOrEqual(viewport!.height);
    await expect(page.getByText(/doesn't open extra connections/)).toHaveCount(1);
  });

  test("opens and closes a skipped check's explanation with the keypad alone", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sheet = await openSwitcher(page);
    await sheet.getByTestId("switch-device-expand-device-reachable").click();
    const config = probeRow(sheet, "config");
    await expect(config).toContainText("Skipped", { timeout: 30_000 });
    const info = config.getByRole("button", { name: "Why was Config skipped?" });

    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press("ArrowDown");
      reached = (await info.getAttribute(SELECTED)) === "true";
    }
    expect(reached, "The focus ring never reached the Config info button").toBe(true);
    const box = await info.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);

    await page.keyboard.press("Enter");
    const explanation = page.getByTestId("health-check-probe-info-config-explanation");
    await expect(explanation).toContainText("changes a setting briefly and puts it back");

    await page.keyboard.press("Escape");
    await expect(explanation).toBeHidden();
    await expect(sheet).toBeVisible();
  });

  test("keeps a tapped explanation open through the list's next check, and Back closes only the explanation", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sheet = await openSwitcher(page);
    await sheet.getByTestId("switch-device-expand-device-reachable").click();
    const telnet = probeRow(sheet, "telnet");
    await expect(telnet).toContainText("Skipped", { timeout: 30_000 });
    await expect(probeRow(sheet, "jiffy")).toContainText("Success", { timeout: 30_000 });

    await telnet.getByRole("button", { name: "Why was Telnet skipped?" }).click();
    const explanation = page.getByTestId("health-check-probe-info-telnet-explanation");
    await expect(explanation).toBeVisible();

    // Observe a completed probe from the next check. A saved-device result has no live-status
    // attribute between rounds, and a fast probe's transient running state can be missed entirely.
    const completedJiffyReads = () =>
      server.requests.filter((request) => {
        const url = new URL(request.url, server.baseUrl);
        return (
          url.pathname === "/v1/machine:readmem" &&
          url.searchParams.get("address")?.toLowerCase() === "00a2" &&
          request.completedAtMs !== null
        );
      }).length;
    const previousJiffyReads = completedJiffyReads();
    await expect.poll(completedJiffyReads, { timeout: 15_000 }).toBeGreaterThan(previousJiffyReads);
    await expect(probeRow(sheet, "jiffy")).toContainText("Success", { timeout: 30_000 });
    await expect(explanation).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(explanation).toBeHidden();
    await expect(sheet).toBeVisible();
  });
});
