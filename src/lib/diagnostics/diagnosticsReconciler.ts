/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { QueryClient } from "@tanstack/react-query";
import { invalidateForVisibilityResume } from "@/lib/query/c64QueryInvalidation";
import { recoverStaleHealthCheckRun, isHealthCheckRunning } from "@/lib/diagnostics/healthCheckEngine";
import {
	degradePlaybackConfidence,
	markPlaybackUncertain,
	setReconcilerState,
	setRepairState,
} from "@/lib/diagnostics/decisionState";
import { getHealthCheckStateSnapshot } from "@/lib/diagnostics/healthCheckState";

type ReconcileResult = {
	driftDetected: boolean;
	actionsTaken: string[];
	detail: string | null;
};

export const runDiagnosticsReconciler = async (reason: string): Promise<ReconcileResult> => {
	const startedAt = new Date().toISOString();
	setReconcilerState(
		"diagnostics",
		{
			lastRunAt: startedAt,
			result: "running",
			actionsTaken: [],
			detail: reason,
		},
		reason,
	);

	try {
		const recovered = recoverStaleHealthCheckRun(reason);
		const snapshot = getHealthCheckStateSnapshot();
		const actionsTaken = recovered ? ["Converted stale health-check run to TIMEOUT"] : [];
		const detail = recovered
			? "Recovered a stale health-check run"
			: snapshot.runState === "RUNNING"
				? "Health check still within its active time budget"
				: "No stale diagnostics execution detected";
		setReconcilerState(
			"diagnostics",
			{
				lastRunAt: new Date().toISOString(),
				result: "success",
				driftDetected: recovered,
				actionsTaken,
				detail,
			},
			reason,
		);
		return { driftDetected: recovered, actionsTaken, detail };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error ?? "Diagnostics reconciliation failed");
		setReconcilerState(
			"diagnostics",
			{
				lastRunAt: new Date().toISOString(),
				result: "failure",
				driftDetected: false,
				actionsTaken: [],
				detail,
			},
			reason,
		);
		throw error;
	}
};

export const runConfigReconciler = async (
	queryClient: QueryClient,
	pathname: string,
	reason: string,
): Promise<ReconcileResult> => {
	const startedAt = new Date().toISOString();
	setReconcilerState(
		"config",
		{
			lastRunAt: startedAt,
			result: "running",
			actionsTaken: [],
			detail: reason,
		},
		reason,
	);

	try {
		invalidateForVisibilityResume(queryClient, pathname);
		const actionsTaken = [`Invalidated and refetched active route queries for ${pathname || "/"}`];
		const detail = "Re-synced UI config views from device-backed queries";
		setReconcilerState(
			"config",
			{
				lastRunAt: new Date().toISOString(),
				result: "success",
				driftDetected: false,
				actionsTaken,
				detail,
			},
			reason,
		);
		return { driftDetected: false, actionsTaken, detail };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error ?? "Config reconciliation failed");
		setReconcilerState(
			"config",
			{
				lastRunAt: new Date().toISOString(),
				result: "failure",
				driftDetected: false,
				actionsTaken: [],
				detail,
			},
			reason,
		);
		throw error;
	}
};

export const runPlaybackReconciler = async (reason: string): Promise<ReconcileResult> => {
	const startedAt = new Date().toISOString();
	setReconcilerState(
		"playback",
		{
			lastRunAt: startedAt,
			result: "running",
			actionsTaken: [],
			detail: reason,
		},
		reason,
	);

	try {
		const before = degradePlaybackConfidence(reason);
		const actionsTaken: string[] = [];
		if (!isHealthCheckRunning() && getHealthCheckStateSnapshot().runState === "TIMEOUT") {
			markPlaybackUncertain("Device health-check timed out; playback certainty reduced", "LOW");
			actionsTaken.push("Marked playback state UNKNOWN/LOW after diagnostics timeout");
		}
		if (actionsTaken.length === 0) {
			actionsTaken.push(`Adjusted playback confidence to ${before.confidence}`);
		}
		const detail = actionsTaken.join(" · ");
		setReconcilerState(
			"playback",
			{
				lastRunAt: new Date().toISOString(),
				result: "success",
				driftDetected: false,
				actionsTaken,
				detail,
			},
			reason,
		);
		return { driftDetected: false, actionsTaken, detail };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error ?? "Playback reconciliation failed");
		setReconcilerState(
			"playback",
			{
				lastRunAt: new Date().toISOString(),
				result: "failure",
				driftDetected: false,
				actionsTaken: [],
				detail,
			},
			reason,
		);
		throw error;
	}
};

export const runRepair = async (queryClient: QueryClient, pathname: string, reason: string) => {
	setRepairState("running");
	try {
		await runDiagnosticsReconciler(reason);
		await runConfigReconciler(queryClient, pathname, reason);
		await runPlaybackReconciler(reason);
		setRepairState("success");
	} catch (error) {
		setRepairState("failure");
		throw error;
	}
};
