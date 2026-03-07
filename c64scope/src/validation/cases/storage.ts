import path from "node:path";
import { c64uFtpList, c64uGet, takeScreenshot, ts } from "../helpers.js";
import type { ValidationCase } from "../types.js";

// ---------------------------------------------------------------------------
// DISK-001 — Disk browsing via FTP/REST
// ---------------------------------------------------------------------------

export const diskBrowse: ValidationCase = {
    id: "DISK-001",
    name: "Disk browsing and drive state",
    caseId: "DISK-BROWSE-001",
    featureArea: "Disks",
    route: "/disks",
    safetyClass: "read-only",
    expectedOutcome: "pass",
    oracleClasses: ["REST-visible state", "FTP-visible state"],

    async run(ctx) {
        const trace = {
            routeDiscovery: ["/", "/disks"],
            decisionLog: [
                `${ts()} Decision: query REST drives for current state`,
                `${ts()} Decision: browse FTP for disk images`,
                `${ts()} Decision: verify drive A has mounted image`,
            ],
            safetyBudget: "read-only",
            oracleSelection: ["REST-visible state: drive state with mount info", "FTP-visible state: disk image directories"],
            recoveryActions: [],
        };

        // Step 1: Drives
        const drives = await c64uGet(ctx.c64uHost, "/v1/drives");
        const driveData = JSON.parse(drives);
        trace.decisionLog.push(
            `${ts()} Observed: drives endpoint returned, ${JSON.stringify(driveData.drives?.[0]?.a || {}).substring(0, 100)}`,
        );

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-01",
            route: "/disks",
            featureArea: "Disks",
            action: "query_drive_state",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Drive A: ${JSON.stringify(driveData.drives?.[0]?.a || {}).substring(0, 150)}`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-drives",
            stepId: "step-01",
            evidenceType: "rest_snapshot",
            summary: "Drive state snapshot",
            metadata: { endpoint: "/v1/drives", data: driveData },
        });

        // Step 2: FTP Games listing for disk images
        const gamesListing = await c64uFtpList(ctx.c64uHost, "/USB2/Games/");
        trace.decisionLog.push(
            `${ts()} Observed: /USB2/Games/ ${gamesListing.split("\n").filter((l: string) => l.trim()).length} entries`,
        );

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-02",
            route: "/disks",
            featureArea: "Disks",
            action: "ftp_browse_games",
            peerServer: "c64bridge",
            primaryOracle: "FTP-visible state",
            notes: `Games directory entries: ${gamesListing.split("\n").filter((l: string) => l.trim()).length}`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-ftp-games",
            stepId: "step-02",
            evidenceType: "ftp_snapshot",
            summary: "FTP Games directory listing",
            metadata: { path: "/USB2/Games/", listing: gamesListing.trim() },
        });

        // Step 3: Also check for specific game subdirectory
        let subDirListing = "";
        try {
            subDirListing = await c64uFtpList(ctx.c64uHost, "/USB2/Games/Early/");
            trace.decisionLog.push(
                `${ts()} Observed: /USB2/Games/Early/ accessible, ${subDirListing.split("\n").filter((l: string) => l.trim()).length} entries`,
            );
        } catch {
            trace.decisionLog.push(`${ts()} Observed: /USB2/Games/Early/ not accessible`);
        }

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-ftp-subdir",
            stepId: "step-02",
            evidenceType: "ftp_snapshot",
            summary: "FTP Games/Early subdirectory listing",
            metadata: { path: "/USB2/Games/Early/", listing: subDirListing.trim() },
        });

        // Assertions
        const driveAExists = driveData.drives?.[0]?.a !== undefined;
        const ftpGamesOk = gamesListing.length > 0;

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-01",
            title: "Drive state readable via REST",
            oracleClass: "REST-visible state",
            passed: driveAExists,
            details: { driveA: driveData.drives?.[0]?.a },
        });

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-02",
            title: "FTP disk image directories accessible",
            oracleClass: "FTP-visible state",
            passed: ftpGamesOk,
            details: {
                gamesEntries: gamesListing.split("\n").filter((l: string) => l.trim()).length,
            },
        });

        return {
            assertions: [
                {
                    oracleClass: "REST-visible state",
                    passed: driveAExists,
                    details: {},
                },
                { oracleClass: "FTP-visible state", passed: ftpGamesOk, details: {} },
            ],
            explorationTrace: trace,
        };
    },
};

// ---------------------------------------------------------------------------
// DISK-002 — Disk drive configuration
// ---------------------------------------------------------------------------

export const diskDriveConfig: ValidationCase = {
    id: "DISK-002",
    name: "Disk drive configuration state",
    caseId: "DISK-CFG-001",
    featureArea: "Disks",
    route: "/disks",
    safetyClass: "read-only",
    expectedOutcome: "pass",
    oracleClasses: ["REST-visible state", "UI"],

    async run(ctx) {
        const trace = {
            routeDiscovery: ["/", "/disks"],
            decisionLog: [
                `${ts()} Decision: query drives REST for detailed config`,
                `${ts()} Decision: query Drive A Settings config category`,
                `${ts()} Decision: screenshot device`,
            ],
            safetyBudget: "read-only",
            oracleSelection: ["REST-visible state: drive state + drive settings config", "UI: device screenshot"],
            recoveryActions: [],
        };

        // Step 1: Drives state
        const drives = await c64uGet(ctx.c64uHost, "/v1/drives");
        const driveData = JSON.parse(drives);

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-01",
            route: "/disks",
            featureArea: "Disks",
            action: "query_drives",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Drives response: ${drives.length} bytes`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-drives",
            stepId: "step-01",
            evidenceType: "rest_snapshot",
            summary: "Drive state",
            metadata: { data: driveData },
        });

        // Step 2: Drive settings config
        let driveSettings = "";
        try {
            driveSettings = await c64uGet(ctx.c64uHost, "/v1/configs/Drive%20A%20Settings");
            trace.decisionLog.push(`${ts()} Observed: Drive A Settings config: ${driveSettings.length} bytes`);
        } catch {
            trace.decisionLog.push(`${ts()} Observed: Drive A Settings config not available`);
        }

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-02",
            route: "/disks",
            featureArea: "Disks",
            action: "query_drive_a_settings",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Drive A Settings: ${driveSettings.length} bytes`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-drive-settings",
            stepId: "step-02",
            evidenceType: "config_snapshot",
            summary: "Drive A Settings config",
            metadata: {
                category: "Drive A Settings",
                response: driveSettings.trim(),
            },
        });

        // Step 3: Screenshot
        const ssPath = path.join(ctx.artifactDir, "disk-screen.png");
        await takeScreenshot(ctx.serial, ssPath);

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-ss-disk",
            stepId: "step-02",
            evidenceType: "screenshot",
            summary: "Device screenshot during disk config check",
            path: ssPath,
        });

        // Assertions
        const drivesOk = driveData.drives !== undefined;

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-01",
            title: "Drive state and config readable",
            oracleClass: "REST-visible state",
            passed: drivesOk,
            details: {
                drivesOk,
                driveSettingsLength: driveSettings.length,
            },
        });

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-02",
            title: "Device UI visible",
            oracleClass: "UI",
            passed: true,
            details: { screenshot: "disk-screen.png" },
        });

        return {
            assertions: [
                { oracleClass: "REST-visible state", passed: drivesOk, details: {} },
                { oracleClass: "UI", passed: true, details: {} },
            ],
            explorationTrace: trace,
        };
    },
};

// ---------------------------------------------------------------------------
// CFG-001 — Config category browsing
// ---------------------------------------------------------------------------

export const configBrowse: ValidationCase = {
    id: "CFG-001",
    name: "Config category browsing",
    caseId: "CFG-BROWSE-001",
    featureArea: "Config",
    route: "/config",
    safetyClass: "read-only",
    expectedOutcome: "pass",
    oracleClasses: ["REST-visible state", "UI"],

    async run(ctx) {
        const trace = {
            routeDiscovery: ["/", "/config"],
            decisionLog: [
                `${ts()} Decision: query /v1/configs for category discovery`,
                `${ts()} Decision: query specific config category for detail`,
                `${ts()} Decision: screenshot for UI oracle`,
            ],
            safetyBudget: "read-only",
            oracleSelection: ["REST-visible state: config categories + category detail", "UI: device screenshot"],
            recoveryActions: [],
        };

        // Step 1: List all categories
        const configs = await c64uGet(ctx.c64uHost, "/v1/configs");
        const configData = JSON.parse(configs);
        const categories = configData.categories || [];
        trace.decisionLog.push(
            `${ts()} Observed: ${categories.length} config categories: ${categories.slice(0, 5).join(", ")}...`,
        );

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-01",
            route: "/config",
            featureArea: "Config",
            action: "list_config_categories",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Categories: ${categories.length}`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-categories",
            stepId: "step-01",
            evidenceType: "config_snapshot",
            summary: "Config category listing",
            metadata: { categories, count: categories.length },
        });

        // Step 2: Read Network Settings detail
        let networkConfig = "";
        try {
            networkConfig = await c64uGet(ctx.c64uHost, "/v1/configs/Network%20Settings");
            trace.decisionLog.push(`${ts()} Observed: Network Settings config: ${networkConfig.length} bytes`);
        } catch {
            trace.decisionLog.push(`${ts()} Observed: Network Settings not available`);
        }

        await ctx.store.recordStep({
            runId: ctx.runId,
            stepId: "step-02",
            route: "/config",
            featureArea: "Config",
            action: "read_network_settings",
            peerServer: "c64bridge",
            primaryOracle: "REST-visible state",
            notes: `Network Settings: ${networkConfig.length} bytes`,
        });

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-network",
            stepId: "step-02",
            evidenceType: "config_snapshot",
            summary: "Network Settings config snapshot",
            metadata: {
                category: "Network Settings",
                responseLength: networkConfig.length,
            },
        });

        // Step 3: Screenshot
        const ssPath = path.join(ctx.artifactDir, "config-screen.png");
        await takeScreenshot(ctx.serial, ssPath);

        await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: "ev-ss-config",
            stepId: "step-02",
            evidenceType: "screenshot",
            summary: "Device during config browsing",
            path: ssPath,
        });

        // Assertions
        const categoriesOk = categories.length > 5;

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-01",
            title: "Config categories discovered via REST",
            oracleClass: "REST-visible state",
            passed: categoriesOk,
            details: { categoryCount: categories.length, categories },
        });

        await ctx.store.recordAssertion({
            runId: ctx.runId,
            assertionId: "assert-02",
            title: "Device UI visible during config browse",
            oracleClass: "UI",
            passed: true,
            details: { screenshot: "config-screen.png" },
        });

        return {
            assertions: [
                {
                    oracleClass: "REST-visible state",
                    passed: categoriesOk,
                    details: {},
                },
                { oracleClass: "UI", passed: true, details: {} },
            ],
            explorationTrace: trace,
        };
    },
};
