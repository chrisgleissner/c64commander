/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import { expect, test, type Page } from "@playwright/test";

import { createMockC64Server, type ConfigItemState } from "../tests/mocks/mockC64Server";
import { seedFtpConfig, startFtpTestServers } from "./ftpTestUtils";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

/**
 * The machine's palette, as the app reads it and as the app changes it.
 *
 * `U64 Specific Settings` / `Palette Definition` holds a bare FILENAME naming a `.vpl` inside
 * `/flash/data`, which the FTP server spells `/Flash/data`. Reading the value as if it were a path
 * is the defect these tests guard: it resolves nowhere on a real device, so the app paints the
 * built-in palette while the row still claims to be following the C64. Every assertion on an FTP
 * path below exists for that reason.
 */

const PALETTE_CATEGORY = "U64 Specific Settings";
const PALETTE_ITEM = "Palette Definition";
const PALETTE_ITEM_PATHNAME = "/v1/configs/U64%20Specific%20Settings/Palette%20Definition";

const DEVICE_VPL = "device-palette.vpl";
const DEVICE_VPL_PATH = `/Flash/data/${DEVICE_VPL}`;
/** `# NAME:` of playwright/fixtures/ftp-root/Flash/data/device-palette.vpl. */
const DEVICE_VPL_NAME = "U64 test palette";
/** Colour index 2 of that fixture: `12 34 56`. */
const DEVICE_VPL_COLOUR_2 = /rgb\(18, 52, 86\)/;
/** Colour index 2 of the firmware's own palette, which the app renders as `Default`. */
const FIRMWARE_COLOUR_2 = /rgb\(141, 47, 52\)/;
/** Colour index 2 of the built-in `Monochrome` palette. */
const MONOCHROME_COLOUR_2 = /rgb\(144, 144, 144\)/;

type PaletteRequests = {
  ftpReadPaths: string[];
  ftpWritePaths: string[];
  configWrites: string[];
};

/**
 * Records the three things a palette change can touch, and keeps the writes off the fixture server.
 *
 * The mock FTP bridge implements `list`, `read` and `ping` only, so `write` and `mkdir` are answered
 * here. That is also what makes the uploaded path observable, which is the point of tests 5 and 6.
 *
 * An uploaded file is kept and served back by the read route. Without that, the app writes a
 * palette, selects it, and then reads a file the fixture FTP server has never heard of — which is
 * an artefact of faking the upload rather than anything the app does wrong.
 */
const trackPaletteRequests = async (page: Page): Promise<PaletteRequests> => {
  const requests: PaletteRequests = { ftpReadPaths: [], ftpWritePaths: [], configWrites: [] };
  const uploaded = new Map<string, string>();

  await page.route("**/v1/ftp/read", async (route) => {
    const body = route.request().postDataJSON() as { path?: string } | null;
    if (body?.path) requests.ftpReadPaths.push(body.path);
    const stored = body?.path ? uploaded.get(body.path) : undefined;
    if (stored === undefined) {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: stored, sizeBytes: Buffer.from(stored, "base64").length }),
    });
  });

  await page.route("**/v1/ftp/write", async (route) => {
    const body = route.request().postDataJSON() as { path?: string; data?: string } | null;
    if (body?.path) {
      requests.ftpWritePaths.push(body.path);
      uploaded.set(body.path, body.data ?? "");
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sizeBytes: Buffer.from(body?.data ?? "", "base64").length }),
    });
  });

  await page.route("**/v1/ftp/mkdir", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ created: true }),
    });
  });

  // A predicate rather than a glob: the write carries `?value=…`, and the pathname is percent
  // encoded, so matching on the decoded pathname is the unambiguous form.
  await page.route(
    (url) => url.pathname === PALETTE_ITEM_PATHNAME,
    async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        requests.configWrites.push(new URL(request.url()).searchParams.get("value") ?? "");
      }
      await route.continue();
    },
  );

  return requests;
};

test.describe("device VIC palette", () => {
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  const start = async (page: Page, palette: string, presets: string[] = ["", DEVICE_VPL]) => {
    const state = JSON.parse(JSON.stringify(uiFixtures.configState)) as Record<string, Record<string, ConfigItemState>>;
    state[PALETTE_CATEGORY] = {
      ...(state[PALETTE_CATEGORY] ?? {}),
      [PALETTE_ITEM]: { value: palette, details: { presets } },
    };
    server = await createMockC64Server(state);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
    });
    await seedUiMocks(page, server.baseUrl);
  };

  const screenColorsRow = (page: Page) => page.getByTestId("home-video-screen-colors");
  const homeSwatch = (page: Page, index: number) =>
    page.getByTestId(`home-video-screen-colors-preview-swatch-${index}`);

  const openSheet = async (page: Page) => {
    const row = screenColorsRow(page);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(page.getByTestId("screen-colors-target")).toBeVisible();
  };

  const closeSheet = async (page: Page) => {
    await page.getByTestId("screen-colors-close").click();
    await expect(page.getByTestId("screen-colors-target")).toBeHidden();
  };

  test("paints the palette the C64 is set to, read from /Flash/data", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, DEVICE_VPL);
    const requests = await trackPaletteRequests(page);
    await page.goto("/");

    // The row names the device's palette and says where the name came from.
    await expect(screenColorsRow(page)).toContainText(`${DEVICE_VPL_NAME} (from C64)`);
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", DEVICE_VPL_COLOUR_2);

    // The regression: `Palette Definition` is a filename, and only `/Flash/data/<filename>` reads it.
    expect(requests.ftpReadPaths).toContain(DEVICE_VPL_PATH);
    expect(requests.ftpReadPaths.filter((path) => path.endsWith(DEVICE_VPL))).toEqual([DEVICE_VPL_PATH]);
  });

  test("falls back to Default without any FTP read when the C64 has no palette file", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, "", [""]);
    const requests = await trackPaletteRequests(page);
    await page.goto("/");

    await expect(screenColorsRow(page)).toContainText("Default (from C64)");
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", FIRMWARE_COLOUR_2);
    expect(requests.ftpReadPaths).toEqual([]);
  });

  test("falls back to Default when the named palette file cannot be read", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, "missing-palette.vpl", ["", "missing-palette.vpl"]);
    const requests = await trackPaletteRequests(page);
    await page.unroute("**/v1/ftp/read");
    await page.route("**/v1/ftp/read", async (route) => {
      const body = route.request().postDataJSON() as { path?: string } | null;
      if (body?.path) requests.ftpReadPaths.push(body.path);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.goto("/");

    await expect(screenColorsRow(page)).toContainText("Default (from C64)");
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", FIRMWARE_COLOUR_2);
    await expect.poll(() => requests.ftpReadPaths).toContain("/Flash/data/missing-palette.vpl");
  });

  test("the Local target changes this device only", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, DEVICE_VPL);
    const requests = await trackPaletteRequests(page);
    await page.goto("/");
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", DEVICE_VPL_COLOUR_2);

    await openSheet(page);
    await page.getByTestId("screen-colors-local").click();
    await expect(page.getByTestId("screen-colors-target-hint")).toContainText("The C64 is not touched");
    // Nothing is being sent to the machine, so the note about copying a file to flash is not shown.
    await expect(page.getByTestId("screen-colors-install-note")).toBeHidden();

    await page.getByTestId("screen-colors-palette-monochrome").click();
    await expect(page.getByTestId("screen-colors-palette-monochrome")).toHaveAttribute("aria-pressed", "true");
    await closeSheet(page);

    await expect(screenColorsRow(page)).toContainText("Monochrome");
    await expect(screenColorsRow(page)).not.toContainText("(from C64)");
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", MONOCHROME_COLOUR_2);

    expect(requests.configWrites).toEqual([]);
    expect(requests.ftpWritePaths).toEqual([]);
  });

  test("the Remote target uploads the .vpl and selects it by filename", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, DEVICE_VPL);
    const requests = await trackPaletteRequests(page);
    await page.goto("/");
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", DEVICE_VPL_COLOUR_2);

    await openSheet(page);
    await page.getByTestId("screen-colors-remote").click();
    await expect(page.getByTestId("screen-colors-target-hint")).toContainText("the television changes too");
    await expect(page.getByTestId("screen-colors-install-note")).toBeVisible();

    await page.getByTestId("screen-colors-palette-monochrome").click();

    // The file goes into the directory the firmware reads palettes from...
    await expect.poll(() => requests.ftpWritePaths).toEqual(["/Flash/data/monochrome.vpl"]);
    // ...and the config item names it, bare, with no path in front of it.
    await expect.poll(() => requests.configWrites).toEqual(["monochrome.vpl"]);

    // Reading the machine back closes the loop: the app is still following the C64, and the palette
    // it now finds there is the one it just uploaded.
    await closeSheet(page);
    await expect(screenColorsRow(page)).toContainText("Monochrome (from C64)");
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", MONOCHROME_COLOUR_2);
    expect(requests.ftpReadPaths).toContain("/Flash/data/monochrome.vpl");
  });

  test("selecting Default clears the config item and uploads nothing", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, DEVICE_VPL);
    const requests = await trackPaletteRequests(page);
    await page.goto("/");
    await expect(homeSwatch(page, 2)).toHaveAttribute("style", DEVICE_VPL_COLOUR_2);

    await openSheet(page);
    await page.getByTestId("screen-colors-remote").click();
    await page.getByTestId("screen-colors-palette-default").click();

    // The firmware's own palette needs no file, so an empty value is the whole change.
    await expect.poll(() => requests.configWrites).toEqual([""]);
    expect(requests.ftpWritePaths).toEqual([]);
  });

  test("offers the palettes already installed on the C64", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, "", ["", DEVICE_VPL]);
    await trackPaletteRequests(page);
    await page.goto("/");

    await openSheet(page);
    const installed = page.getByTestId("screen-colors-device-palettes");
    await expect(installed).toBeVisible();
    await expect(installed.getByTestId(`screen-colors-palette-device:${DEVICE_VPL}`)).toBeVisible();
    await expect(installed).toContainText(DEVICE_VPL_NAME);
    await expect(installed.getByTestId(`screen-colors-palette-device:${DEVICE_VPL}-strip-swatch-2`)).toHaveAttribute(
      "style",
      DEVICE_VPL_COLOUR_2,
    );
  });
});
