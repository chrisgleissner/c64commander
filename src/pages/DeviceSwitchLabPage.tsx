import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { useSavedDeviceSwitching } from "@/hooks/useSavedDeviceSwitching";
import { logger } from "@/lib/diagnostics/logger";
import { emitNativeDiagnosticsLog } from "@/lib/native/diagnosticsBridge";
import {
  clearSavedDeviceSwitchMetrics,
  computeSavedDeviceSwitchLatencySummary,
  getSavedDeviceSwitchMetricsSnapshot,
  SAVED_DEVICE_SWITCH_METRICS_EVENT,
  type SavedDeviceSwitchAttempt,
} from "@/lib/savedDevices/savedDeviceSwitchMetrics";

type SoakPlanConfig = {
  fromDeviceId?: string;
  toDeviceId?: string;
  iterations?: number;
  interSwitchDelayMs?: number;
  autorun?: boolean;
};

type SoakResult = {
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  fromDeviceId: string;
  toDeviceId: string;
  iterations: number;
  interSwitchDelayMs: number;
  totalTransitions: number;
  summary: ReturnType<typeof computeSavedDeviceSwitchLatencySummary>;
  failures: SavedDeviceSwitchAttempt[];
};

type SoakRunnerResult = {
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  fromDeviceId: string;
  toDeviceId: string;
  iterations: number;
  interSwitchDelayMs: number;
  totalTransitions: number;
  summary: ReturnType<typeof computeSavedDeviceSwitchLatencySummary>;
  failureCount: number;
  failureSamples: Array<{
    id: string;
    fromDeviceId: string | null;
    toDeviceId: string;
    outcome: SavedDeviceSwitchAttempt["outcome"];
    totalDurationMs: number | null;
    verificationDurationMs: number | null;
    errorMessage: string | null;
  }>;
  omittedFailureCount: number;
};

const DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER = "C64_SWITCH_LAB_RUNNER_RESULT";

declare global {
  interface ImportMetaEnv {
    VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON?: string;
  }

  interface Window {
    __c64uLastDeviceSwitchLabResult?: SoakResult;
  }
}

const DEFAULT_ITERATIONS = 8;
const DEFAULT_DELAY_MS = 150;

const sleep = (delayMs: number) => new Promise((resolve) => window.setTimeout(resolve, delayMs));

const readDebugPlan = (): SoakPlanConfig | null => {
  const raw = import.meta.env.VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON;
  if (!raw?.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as SoakPlanConfig;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn("Failed to parse device switch soak debug plan", {
      details: {
        error: error instanceof Error ? error.message : String(error ?? "Unknown parse failure"),
      },
      component: "switch-lab",
    });
    return null;
  }
};

const buildResultPayload = (args: {
  status: "completed" | "failed";
  startedAt: string;
  fromDeviceId: string;
  toDeviceId: string;
  iterations: number;
  interSwitchDelayMs: number;
}) => {
  const snapshot = getSavedDeviceSwitchMetricsSnapshot();
  const failures = snapshot.attempts.filter((attempt) => attempt.outcome === "offline" || attempt.outcome === "error");
  return {
    status: args.status,
    startedAt: args.startedAt,
    completedAt: new Date().toISOString(),
    fromDeviceId: args.fromDeviceId,
    toDeviceId: args.toDeviceId,
    iterations: args.iterations,
    interSwitchDelayMs: args.interSwitchDelayMs,
    totalTransitions: snapshot.attempts.length,
    summary: computeSavedDeviceSwitchLatencySummary(snapshot.attempts),
    failures,
  } satisfies SoakResult;
};

const buildRunnerResultPayload = (result: SoakResult): SoakRunnerResult => {
  const failureSamples = result.failures.slice(0, 3).map((failure) => ({
    id: failure.id,
    fromDeviceId: failure.fromDeviceId,
    toDeviceId: failure.toDeviceId,
    outcome: failure.outcome,
    totalDurationMs: failure.totalDurationMs,
    verificationDurationMs: failure.verificationDurationMs,
    errorMessage: failure.errorMessage,
  }));

  return {
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    fromDeviceId: result.fromDeviceId,
    toDeviceId: result.toDeviceId,
    iterations: result.iterations,
    interSwitchDelayMs: result.interSwitchDelayMs,
    totalTransitions: result.totalTransitions,
    summary: result.summary,
    failureCount: result.failures.length,
    failureSamples,
    omittedFailureCount: Math.max(0, result.failures.length - failureSamples.length),
  };
};

const emitLabResult = async (result: SoakResult) => {
  window.__c64uLastDeviceSwitchLabResult = result;
  logger.info("Saved-device switch soak completed", {
    details: result,
    component: "switch-lab",
  });
  console.info(`C64_SWITCH_LAB_RESULT ${JSON.stringify(result)}`);
  const serializedRunnerResult = `${DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER} ${JSON.stringify(buildRunnerResultPayload(result))}`;
  await emitNativeDiagnosticsLog({
    level: "info",
    message: serializedRunnerResult,
    component: "switch-lab",
  });
};

export default function DeviceSwitchLabPage() {
  const navigate = useNavigate();
  const savedDevices = useSavedDevices();
  const switchSavedDevice = useSavedDeviceSwitching();
  const debugPlan = useMemo(readDebugPlan, []);
  const devices = savedDevices.devices;
  const defaultFromDeviceId =
    (debugPlan?.fromDeviceId && devices.find((device) => device.id === debugPlan.fromDeviceId)?.id) ||
    savedDevices.selectedDeviceId ||
    devices[0]?.id ||
    "";
  const defaultToDeviceId =
    (debugPlan?.toDeviceId && devices.find((device) => device.id === debugPlan.toDeviceId)?.id) ||
    devices.find((device) => device.id !== defaultFromDeviceId)?.id ||
    defaultFromDeviceId;

  const [fromDeviceId, setFromDeviceId] = useState(defaultFromDeviceId);
  const [toDeviceId, setToDeviceId] = useState(defaultToDeviceId);
  const [iterations, setIterations] = useState(debugPlan?.iterations ?? DEFAULT_ITERATIONS);
  const [interSwitchDelayMs, setInterSwitchDelayMs] = useState(debugPlan?.interSwitchDelayMs ?? DEFAULT_DELAY_MS);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [metricsVersion, setMetricsVersion] = useState(0);
  const [result, setResult] = useState<SoakResult | null>(null);
  const autorunStartedRef = useRef(false);

  useEffect(() => {
    const handleMetrics = () => {
      setMetricsVersion((current) => current + 1);
    };

    window.addEventListener(SAVED_DEVICE_SWITCH_METRICS_EVENT, handleMetrics);
    return () => window.removeEventListener(SAVED_DEVICE_SWITCH_METRICS_EVENT, handleMetrics);
  }, []);

  useEffect(() => {
    if (!fromDeviceId && defaultFromDeviceId) {
      setFromDeviceId(defaultFromDeviceId);
    }
    if (!toDeviceId && defaultToDeviceId) {
      setToDeviceId(defaultToDeviceId);
    }
  }, [defaultFromDeviceId, defaultToDeviceId, fromDeviceId, toDeviceId]);

  const metricsSnapshot = useMemo(() => getSavedDeviceSwitchMetricsSnapshot(), [metricsVersion]);

  const summary = useMemo(
    () => computeSavedDeviceSwitchLatencySummary(metricsSnapshot.attempts),
    [metricsSnapshot.attempts],
  );

  const runDirectedSwitch = useCallback(
    async (deviceId: string) => {
      setRunError(null);
      await switchSavedDevice(deviceId);
    },
    [switchSavedDevice],
  );

  const runPingPongSoak = useCallback(async () => {
    if (!fromDeviceId || !toDeviceId || fromDeviceId === toDeviceId) {
      setRunError("Choose two different saved devices before running the soak.");
      return;
    }

    setRunning(true);
    setRunError(null);
    clearSavedDeviceSwitchMetrics();
    const startedAt = new Date().toISOString();

    try {
      if (savedDevices.selectedDeviceId !== fromDeviceId) {
        await switchSavedDevice(fromDeviceId);
        if (interSwitchDelayMs > 0) {
          await sleep(interSwitchDelayMs);
        }
      }

      for (let index = 0; index < iterations; index += 1) {
        await switchSavedDevice(toDeviceId);
        if (interSwitchDelayMs > 0) {
          await sleep(interSwitchDelayMs);
        }
        await switchSavedDevice(fromDeviceId);
        if (interSwitchDelayMs > 0 && index < iterations - 1) {
          await sleep(interSwitchDelayMs);
        }
      }

      const nextResult = buildResultPayload({
        status: "completed",
        startedAt,
        fromDeviceId,
        toDeviceId,
        iterations,
        interSwitchDelayMs,
      });
      setResult(nextResult);
      await emitLabResult(nextResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unknown switch soak failure");
      setRunError(message);
      const nextResult = buildResultPayload({
        status: "failed",
        startedAt,
        fromDeviceId,
        toDeviceId,
        iterations,
        interSwitchDelayMs,
      });
      setResult(nextResult);
      await emitLabResult(nextResult);
    } finally {
      setRunning(false);
    }
  }, [fromDeviceId, interSwitchDelayMs, iterations, savedDevices.selectedDeviceId, switchSavedDevice, toDeviceId]);

  useEffect(() => {
    if (autorunStartedRef.current) {
      return;
    }
    if (debugPlan?.autorun === false) {
      return;
    }
    if (devices.length < 2 || !fromDeviceId || !toDeviceId || fromDeviceId === toDeviceId) {
      return;
    }
    autorunStartedRef.current = true;
    void runPingPongSoak();
  }, [debugPlan?.autorun, devices.length, fromDeviceId, runPingPongSoak, toDeviceId]);

  return (
    <div
      className="fixed inset-0 z-[2147483645] overflow-auto bg-slate-950/92 px-4 py-6 text-slate-50"
      data-testid="device-switch-lab-page"
    >
      <div className="mx-auto max-w-5xl space-y-6 rounded-3xl border border-white/10 bg-slate-900/95 p-5 shadow-2xl shadow-black/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">Device Switch Lab</p>
            <h1 className="text-2xl font-semibold">Rapid saved-device switching soak</h1>
            <p className="max-w-3xl text-sm text-slate-300">
              Runs the real saved-device switch hook, captures per-switch latency, and surfaces failures as structured
              evidence in both the page and the device logs.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => navigate("/settings")}>
              Close
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => clearSavedDeviceSwitchMetrics()}
              disabled={running}
            >
              Clear Metrics
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm" htmlFor="switch-lab-from-device">
                <span className="font-medium text-slate-200">From device</span>
                <select
                  id="switch-lab-from-device"
                  data-testid="switch-lab-from-device"
                  value={fromDeviceId}
                  disabled={running}
                  onChange={(event) => setFromDeviceId(event.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                >
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} ({device.host})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm" htmlFor="switch-lab-to-device">
                <span className="font-medium text-slate-200">To device</span>
                <select
                  id="switch-lab-to-device"
                  data-testid="switch-lab-to-device"
                  value={toDeviceId}
                  disabled={running}
                  onChange={(event) => setToDeviceId(event.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                >
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} ({device.host})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm" htmlFor="switch-lab-iterations">
                <span className="font-medium text-slate-200">Ping-pong iterations</span>
                <input
                  id="switch-lab-iterations"
                  data-testid="switch-lab-iterations"
                  type="number"
                  min={1}
                  max={250}
                  value={iterations}
                  disabled={running}
                  onChange={(event) => setIterations(Math.max(1, Number(event.target.value) || DEFAULT_ITERATIONS))}
                  className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                />
              </label>
              <label className="space-y-2 text-sm" htmlFor="switch-lab-delay-ms">
                <span className="font-medium text-slate-200">Delay between switches (ms)</span>
                <input
                  id="switch-lab-delay-ms"
                  data-testid="switch-lab-delay-ms"
                  type="number"
                  min={0}
                  max={5000}
                  value={interSwitchDelayMs}
                  disabled={running}
                  onChange={(event) =>
                    setInterSwitchDelayMs(Math.max(0, Number(event.target.value) || DEFAULT_DELAY_MS))
                  }
                  className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void runDirectedSwitch(fromDeviceId)}
                disabled={running || !fromDeviceId}
              >
                Switch To From Device
              </Button>
              <Button
                type="button"
                onClick={() => void runDirectedSwitch(toDeviceId)}
                disabled={running || !toDeviceId}
              >
                Switch To To Device
              </Button>
              <Button
                type="button"
                data-testid="switch-lab-run-soak"
                onClick={() => void runPingPongSoak()}
                disabled={running || devices.length < 2}
              >
                {running ? "Running soak..." : "Run ping-pong soak"}
              </Button>
            </div>

            <div
              data-testid="switch-lab-status"
              className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200"
            >
              <p>
                Current selected device: <strong>{savedDevices.selectedDeviceId || "none"}</strong>
              </p>
              <p>
                Active attempt:{" "}
                <strong>{metricsSnapshot.activeAttemptId ? "running" : running ? "queued" : "idle"}</strong>
              </p>
              {runError ? <p className="text-rose-300">Last error: {runError}</p> : null}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Latency Summary</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <dt className="text-slate-400">Transitions</dt>
                <dd className="text-xl font-semibold">{summary.count}</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <dt className="text-slate-400">Failures</dt>
                <dd className="text-xl font-semibold text-rose-300">{summary.failureCount}</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <dt className="text-slate-400">p50</dt>
                <dd className="text-xl font-semibold">{summary.p50DurationMs ?? "-"}ms</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <dt className="text-slate-400">p90</dt>
                <dd className="text-xl font-semibold">{summary.p90DurationMs ?? "-"}ms</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <dt className="text-slate-400">Max</dt>
                <dd className="text-xl font-semibold">{summary.maxDurationMs ?? "-"}ms</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <dt className="text-slate-400">Average</dt>
                <dd className="text-xl font-semibold">{summary.averageDurationMs ?? "-"}ms</dd>
              </div>
            </dl>
          </section>
        </div>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Structured Result</h2>
            <span className="text-xs text-slate-400">Also emitted as C64_SWITCH_LAB_RESULT in console/logcat</span>
          </div>
          <pre
            data-testid="switch-lab-result-json"
            className="max-h-64 overflow-auto rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-xs text-slate-200"
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Attempts</h2>
          <div className="overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="bg-slate-950/90 text-left text-slate-400">
                <tr>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Verify</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-950/60 text-slate-200">
                {metricsSnapshot.attempts.map((attempt) => (
                  <tr key={attempt.id} data-testid={`switch-lab-attempt-${attempt.id}`}>
                    <td className="px-3 py-2">
                      {attempt.fromDeviceId || "none"} -&gt; {attempt.toDeviceId}
                    </td>
                    <td className="px-3 py-2">{attempt.outcome}</td>
                    <td className="px-3 py-2">{attempt.totalDurationMs ?? "-"}ms</td>
                    <td className="px-3 py-2">{attempt.verificationDurationMs ?? "-"}ms</td>
                    <td className="px-3 py-2 text-rose-300">{attempt.errorMessage ?? "-"}</td>
                  </tr>
                ))}
                {metricsSnapshot.attempts.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-400" colSpan={5}>
                      No switch attempts recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
