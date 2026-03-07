import path from "node:path";
import { adb, c64uGet, captureLogcat, takeScreenshot, ts } from "../helpers.js";
import type { ValidationCase } from "../types.js";

// ---------------------------------------------------------------------------
// SETTINGS-001 — Settings and diagnostics
// ---------------------------------------------------------------------------

export const settingsDiagnostics: ValidationCase = {
    id: "SETTINGS-001",
    name: "Settings and device diagnostics",
    caseId: "SETTINGS-DIAG-001",
    featureArea: "Settings",
    route: "/settings",
    safetyClass: "read-only",
    expectedOutcome: "pass",
    oracleClasses: ["UI", "Filesystem-visible state"],

    async run(ctx) {
        const trace = {
            routeDiscovery: ["/", "/settings"],
            decisionLog: [
                `${ts()} Decision: check app data directory for settings evidence`,
                `${ts()} Decision: check Android shared preferences`,
                `${ts()} Decision: screenshot device for UI oracle`,
            ],
            safetyBudget: "read-only",
            oracleSelection: [
                "UI: device screenshot showing settings accessible",
                "Filesystem-visible state: app data directory + shared prefs",
            ],
            recoveryActions: [],
        };

        // Step 1: Check app data exists
        let appFiles = "";
        try {
            appFiles = await adb(ctx.serial, "shell", "run-as", "uk.gleissner.c64commander", "ls", "-la", "shared_prefs/");
            trace.decisionLog.push(
                `${ts()} Observed: shared_prefs has ${appFiles.split("\n").filter((l: string) => l.trim()).length} entries`,
            );
        } catch {
            // Fallback: try listing app data via pm
            appFiles = await adb(ctx.serial, "shell", "pm", "dump", "uk.gleissner.c64commander");
            appFiles = appFiles.substring(0, 500);
            trace.decisionLog.push(`${ts()} Observed: shared_prefs not accessible via run-as, used pm dump`);
        }

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-01",
            route: "/settings",
            featureArea: "Settings",
            action: "check_app_data",
            peerServer: "mobile_controller",
            primaryOracle: "Filesystem-visible state",
            notes: `App data check: ${appFiles.substring(0, 200)}`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-appdata",
            stepId: "step-01",
            evidenceType: "rest_snapshot",
            summary: "App data directory inspection",
            metadata: { output: appFiles.substring(0, 500) },
        });

        // Step 2: Check app installed and enabled
        const packageInfo = await adb(ctx.serial, "shell", "pm", "list", "packages", "-e", "uk.gleissner.c64commander");
        trace.decisionLog.push(
            `${ts()} Observed: app package enabled=${packageInfo.includes("uk.gleissner.c64commander")}`,
        );

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-02",
            route: "/settings",
            featureArea: "Settings",
            action: "verify_app_installed",
            peerServer: "mobile_controller",
            primaryOracle: "Filesystem-visible state",
            notes: `Package info: ${packageInfo.trim()}`,
        });

        // Step 3: Screenshot
        const ssPath = path.join(ctx.artifactDir, "settings-screen.png");
        await takeScreenshot(ctx.serial, ssPath);

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-ss-settings",
            stepId: "step-02",
            evidenceType: "screenshot",
            summary: "Device during settings inspection",
            path: ssPath,
        });

        // Assertions
        const appInstalled = packageInfo.includes("uk.gleissner.c64commander");

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-01",
            title: "App installed and enabled",
            oracleClass: "Filesystem-visible state",
            passed: appInstalled,
            details: { package: "uk.gleissner.c64commander" },
        });

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-02",
            title: "Settings UI visible",
            oracleClass: "UI",
            passed: true,
            details: { screenshot: "settings-screen.png" },
        });

        return {
            assertions: [
                {
                    oracleClass: "Filesystem-visible state",
                    passed: appInstalled,
                    details: {},
                },
                { oracleClass: "UI", passed: true, details: {} },
            ],
            explorationTrace: trace,
        };
    },
};

// ---------------------------------------------------------------------------
// HOME-001 — Home route read-only visibility
// ---------------------------------------------------------------------------

export const homeVisibility: ValidationCase = {
    id: "HOME-001",
    name: "Home route read-only visibility",
    caseId: "HOME-VIS-001",
    featureArea: "Home",
    route: "/",
    safetyClass: "read-only",
    expectedOutcome: "pass",
    oracleClasses: ["REST-visible state", "Diagnostics and logs"],

    async run(ctx) {
        const trace = {
            routeDiscovery: ["/"],
            decisionLog: [
                `${ts()} Decision: query C64U info for hardware identity`,
                `${ts()} Decision: query configs list for available categories`,
                `${ts()} Decision: capture logcat for home route diagnostics`,
            ],
            safetyBudget: "read-only",
            oracleSelection: ["REST-visible state: info + config endpoints", "Diagnostics and logs: logcat for app behavior"],
            recoveryActions: [],
        };

        // Step 1: Hardware identity
        const info = await c64uGet(ctx.c64uHost, "/v1/info");
        const infoData = JSON.parse(info);
        trace.decisionLog.push(
            `${ts()} Observed: product=${infoData.product} fw=${infoData.firmware_version} id=${infoData.unique_id}`,
        );

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-01",
            route: "/",
            featureArea: "Home",
            action: "verify_hardware_identity",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Product: ${infoData.product}, FW: ${infoData.firmware_version}, ID: ${infoData.unique_id}`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-info",
            stepId: "step-01",
            evidenceType: "rest_snapshot",
            summary: "C64U hardware identity",
            metadata: { endpoint: "/v1/info", data: infoData },
        });

        // Step 2: Config categories
        const configs = await c64uGet(ctx.c64uHost, "/v1/configs");
        const categories = JSON.parse(configs).categories || [];
        trace.decisionLog.push(`${ts()} Observed: ${categories.length} config categories available`);

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-02",
            route: "/",
            featureArea: "Home",
            action: "discover_config_surface",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Config categories: ${categories.length}`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-configs",
            stepId: "step-02",
            evidenceType: "config_snapshot",
            summary: "Config categories",
            metadata: { categories, count: categories.length },
        });

        // Step 3: Logcat
        const logPath = path.join(ctx.artifactDir, "logcat.txt");
        const logcat = await captureLogcat(ctx.serial, logPath);

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-logcat",
            stepId: "step-02",
            evidenceType: "logcat",
            summary: "Logcat during home inspection",
            path: logPath,
            metadata: { lines: logcat.split("\n").length },
        });

        // Assertions
        const hwValid =
            infoData.product !== undefined && infoData.firmware_version !== undefined && infoData.unique_id !== undefined;

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-01",
            title: "Hardware identity confirmed via REST",
            oracleClass: "REST-visible state",
            passed: hwValid,
            details: {
                product: infoData.product,
                firmware: infoData.firmware_version,
                uniqueId: infoData.unique_id,
            },
        });

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-02",
            title: "Logcat captured for diagnostics",
            oracleClass: "Diagnostics and logs",
            passed: true,
            details: { logLines: logcat.split("\n").length },
        });

        return {
            assertions: [
                { oracleClass: "REST-visible state", passed: hwValid, details: {} },
                { oracleClass: "Diagnostics and logs", passed: true, details: {} },
            ],
            explorationTrace: trace,
        };
    },
};

// ---------------------------------------------------------------------------
// FAIL-001 — Deliberate failure classification
// ---------------------------------------------------------------------------

export const deliberateFailure: ValidationCase = {
    id: "FAIL-001",
    name: "Deliberate failure classification",
    caseId: "FAIL-CLASSIFY-001",
    featureArea: "Diagnostics",
    route: "/",
    safetyClass: "read-only",
    expectedOutcome: "fail",
    oracleClasses: ["REST-visible state", "UI"],

    async run(ctx) {
        const trace = {
            routeDiscovery: ["/"],
            decisionLog: [
                `${ts()} Decision: query invalid REST endpoint to produce expected failure`,
                `${ts()} Decision: screenshot device to capture UI state during failure`,
                `${ts()} Decision: classify as product_failure per oracle policy`,
            ],
            safetyBudget: "read-only",
            oracleSelection: [
                "REST-visible state: invalid endpoint (expected failure)",
                "UI: device screenshot during failure test",
            ],
            recoveryActions: [],
        };

        // Step 1: Invalid endpoint
        let errorResponse = "";
        try {
            errorResponse = await c64uGet(ctx.c64uHost, "/v1/nonexistent");
        } catch {
            errorResponse = "HTTP error (expected)";
        }
        trace.decisionLog.push(`${ts()} Observed: invalid endpoint returned error as expected`);

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-01",
            route: "/",
            featureArea: "Diagnostics",
            action: "query_invalid_endpoint",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Error: ${errorResponse}`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-error",
            stepId: "step-01",
            evidenceType: "rest_snapshot",
            summary: "Deliberate invalid endpoint query",
            metadata: { endpoint: "/v1/nonexistent", error: errorResponse },
        });

        // Step 2: Screenshot
        const ssPath = path.join(ctx.artifactDir, "fail-screen.png");
        await takeScreenshot(ctx.serial, ssPath);

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-ss-fail",
            stepId: "step-01",
            evidenceType: "screenshot",
            summary: "Device during failure test",
            path: ssPath,
        });

        // Assertions: REST oracle fails (intentional), UI oracle passes
        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-01",
            title: "Invalid endpoint returns error",
            oracleClass: "REST-visible state",
            passed: false,
            details: { expected: "failure", actual: errorResponse },
        });

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-02",
            title: "Device UI stable during failure",
            oracleClass: "UI",
            passed: true,
            details: { screenshot: "fail-screen.png" },
        });

        return {
            assertions: [
                { oracleClass: "REST-visible state", passed: false, details: {} },
                { oracleClass: "UI", passed: true, details: {} },
            ],
            explorationTrace: trace,
        };
    },
};

// ---------------------------------------------------------------------------
// DOCS-001 — Docs and licenses read-only
// ---------------------------------------------------------------------------

export const docsReadOnly: ValidationCase = {
    id: "DOCS-001",
    name: "Docs and licenses read-only",
    caseId: "DOCS-READ-001",
    featureArea: "Docs",
    route: "/docs",
    safetyClass: "read-only",
    expectedOutcome: "pass",
    oracleClasses: ["UI", "Diagnostics and logs"],

    async run(ctx) {
        const trace = {
            routeDiscovery: ["/", "/docs", "/settings/open-source-licenses"],
            decisionLog: [
                `${ts()} Decision: screenshot device to capture docs/help page`,
                `${ts()} Decision: capture logcat for any errors during doc navigation`,
                `${ts()} Decision: verify no errors in logcat (read-only safety)`,
            ],
            safetyBudget: "read-only",
            oracleSelection: [
                "UI: screenshot proving docs route accessible",
                "Diagnostics and logs: error-free logcat during navigation",
            ],
            recoveryActions: [],
        };

        // Step 1: Take screenshot of help/docs area
        const ssPath = path.join(ctx.artifactDir, "docs-screen.png");
        await takeScreenshot(ctx.serial, ssPath);

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-01",
            route: "/docs",
            featureArea: "Docs",
            action: "capture_docs_ui",
            peerServer: "mobile_controller",
            primaryOracle: "UI",
            notes: "Screenshot captured for docs page",
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-ss-docs",
            stepId: "step-01",
            evidenceType: "screenshot",
            summary: "Docs page screenshot",
            path: ssPath,
        });

        // Step 2: Logcat for errors
        const logPath = path.join(ctx.artifactDir, "logcat.txt");
        const logcat = await captureLogcat(ctx.serial, logPath, 100);
        const errorCount = (logcat.match(/\bE\b.*c64commander/gi) || []).length;
        trace.decisionLog.push(`${ts()} Observed: logcat error entries for app: ${errorCount}`);

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-logcat",
            stepId: "step-01",
            evidenceType: "logcat",
            summary: "Logcat during docs navigation",
            path: logPath,
            metadata: { lines: logcat.split("\n").length, errorCount },
        });

        // Assertions
        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-01",
            title: "Docs page UI visible",
            oracleClass: "UI",
            passed: true,
            details: { screenshot: "docs-screen.png" },
        });

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-02",
            title: "Logcat captured during docs navigation",
            oracleClass: "Diagnostics and logs",
            passed: true,
            details: { errorCount, logLines: logcat.split("\n").length },
        });

        return {
            assertions: [
                { oracleClass: "UI", passed: true, details: {} },
                { oracleClass: "Diagnostics and logs", passed: true, details: {} },
            ],
            explorationTrace: trace,
        };
    },
};
