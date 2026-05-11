import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

type DeviceSwitchLabResult = {
  status: "completed" | "failed";
  fromDeviceId: string;
  toDeviceId: string;
  iterations: number;
  totalTransitions: number;
  failures: Array<{ errorMessage: string | null; outcome: string }>;
  summary: {
    count: number;
    successCount: number;
    failureCount: number;
    p50DurationMs: number | null;
    p90DurationMs: number | null;
  };
};

const configureDualSavedDevices = async (page: Page, primaryBaseUrl: string, secondaryBaseUrl: string) => {
  await page.addInitScript(
    ({ firstBaseUrl, secondBaseUrl }: { firstBaseUrl: string; secondBaseUrl: string }) => {
      const buildDevice = (id: string, name: string, baseUrl: string) => {
        const parsed = new URL(baseUrl);
        return {
          id,
          name,
          nameSource: "custom",
          host: parsed.hostname,
          httpPort: Number(parsed.port) || 80,
          ftpPort: 21,
          telnetPort: 23,
          lastKnownProduct: name,
          lastKnownHostname: parsed.hostname,
          lastKnownUniqueId: null,
          hasPassword: false,
        };
      };

      const routingWindow = window as Window & {
        __c64uAllowedBaseUrls?: string[];
        __c64uExpectedBaseUrl?: string;
        __c64uSecureStorageOverride?: unknown;
        __c64uTestProbeEnabled?: boolean;
      };
      routingWindow.__c64uTestProbeEnabled = true;
      routingWindow.__c64uExpectedBaseUrl = firstBaseUrl;
      routingWindow.__c64uAllowedBaseUrls = [firstBaseUrl, secondBaseUrl];
      delete routingWindow.__c64uSecureStorageOverride;
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");

      const firstDevice = buildDevice("switch-primary", "u64", firstBaseUrl);
      const secondDevice = buildDevice("switch-secondary", "c64u", secondBaseUrl);
      localStorage.setItem(
        "c64u_saved_devices:v1",
        JSON.stringify({
          version: 1,
          selectedDeviceId: firstDevice.id,
          devices: [firstDevice, secondDevice],
          summaries: {},
          summaryLru: [],
          hasEverHadMultipleDevices: true,
        }),
      );
      localStorage.setItem("c64u_device_host", new URL(firstBaseUrl).host);
      localStorage.setItem("c64commander:device_host", new URL(firstBaseUrl).host);
      localStorage.setItem("c64u_base_url", firstBaseUrl);
    },
    { firstBaseUrl: primaryBaseUrl, secondBaseUrl: secondaryBaseUrl },
  );
};

declare global {
  interface Window {
    __c64uLastDeviceSwitchLabResult?: DeviceSwitchLabResult;
  }
}

test.describe("device switch soak", () => {
  let primaryServer: Awaited<ReturnType<typeof createMockC64Server>>;
  let secondaryServer: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    primaryServer = await createMockC64Server(uiFixtures.configState, {}, { timingMode: "fast" });
    secondaryServer = await createMockC64Server(uiFixtures.configState, {}, { timingMode: "fast" });
    await seedUiMocks(page, primaryServer.baseUrl);
    await configureDualSavedDevices(page, primaryServer.baseUrl, secondaryServer.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await primaryServer.close();
      await secondaryServer.close();
    }
  });

  test("auto-runs a ping-pong soak across mocked saved devices", async ({ page }: { page: Page }) => {
    await page.goto("/__device-switch__", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__c64uLastDeviceSwitchLabResult?.status === "completed", null, {
      timeout: 120000,
    });

    const result = await page.evaluate(() => window.__c64uLastDeviceSwitchLabResult ?? null);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("completed");
    expect(result?.failures).toHaveLength(0);
    expect(result?.summary.failureCount).toBe(0);
    expect(result?.summary.successCount).toBe(result?.totalTransitions);
    expect(result?.totalTransitions).toBe(result?.iterations * 2);
    expect(result?.summary.count).toBe(result?.totalTransitions);
    expect(result?.summary.p50DurationMs).not.toBeNull();
    expect(result?.summary.p90DurationMs).not.toBeNull();
    await expect(page.getByTestId("switch-lab-result-json")).toContainText('"status": "completed"');
  });
});
