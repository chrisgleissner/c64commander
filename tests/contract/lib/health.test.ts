import { describe, expect, it } from "vitest";
import { MultiProtocolHealthMonitor, type ProbeFn } from "./health.js";

describe("MultiProtocolHealthMonitor", () => {
  it("treats telnet as optional when the required protocols are healthy", async () => {
    const monitor = new MultiProtocolHealthMonitor([
      healthyProbe("REST"),
      healthyProbe("ICMP"),
      healthyProbe("FTP"),
      failingProbe("TELNET"),
    ]);

    const result = await monitor.check({ source: "test:optional-telnet" });

    expect(result.state).toBe("HEALTHY");
    expect(result.abort).toBe(false);
  });

  it("emits a protocol transition when rest becomes unavailable", async () => {
    const transitions: string[] = [];
    const monitor = new MultiProtocolHealthMonitor([failingProbe("REST"), healthyProbe("ICMP"), healthyProbe("FTP")], {
      verificationWindowMs: 5,
      verificationBackoffMs: [1],
      onProtocolTransition: (transition) => {
        transitions.push(`${transition.protocol}:${transition.to ? "available" : "unavailable"}`);
      },
    });

    await monitor.check({ source: "test:protocol-transition" });

    expect(transitions).toContain("REST:unavailable");
  });

  it("classifies transient partial failure as degraded after the verification window", async () => {
    let attempt = 0;
    const monitor = new MultiProtocolHealthMonitor(
      [
        probeSequence("REST", [false, true, true]),
        probeSequence("ICMP", [true, true, true]),
        probeSequence("FTP", [true, true, true]),
      ],
      {
        verificationWindowMs: 5,
        verificationBackoffMs: [1],
      },
    );

    const result = await monitor.check({ source: "test:transient" });

    expect(result.state).toBe("DEGRADED");
    expect(result.abort).toBe(false);
    expect(result.transition?.to).toBe("DEGRADED");

    function probeSequence(protocol: "REST" | "ICMP" | "FTP", sequence: boolean[]): ProbeFn {
      return async () => {
        const ok = sequence[Math.min(attempt, sequence.length - 1)] ?? true;
        if (protocol === "FTP") {
          attempt += 1;
        }
        return {
          protocol,
          ok,
          timestamp: new Date().toISOString(),
          status: ok ? 200 : `${protocol.toLowerCase()}-failed`,
          latencyMs: 1,
          error: ok ? undefined : `${protocol} failed`,
        };
      };
    }
  });

  it("classifies persistent cross-protocol failure as unresponsive", async () => {
    const monitor = new MultiProtocolHealthMonitor([failingProbe("REST"), failingProbe("ICMP"), failingProbe("FTP")], {
      verificationWindowMs: 5,
      verificationBackoffMs: [1],
    });

    const result = await monitor.check({ source: "test:persistent" });

    expect(result.state).toBe("UNRESPONSIVE");
    expect(result.abort).toBe(true);
    expect(result.reason).toMatch(/failed continuously/);
  });
});

function failingProbe(protocol: "REST" | "ICMP" | "FTP" | "TELNET"): ProbeFn {
  return async () => ({
    protocol,
    ok: false,
    timestamp: new Date().toISOString(),
    status: `${protocol.toLowerCase()}-failed`,
    latencyMs: 1,
    error: `${protocol} failed`,
  });
}

function healthyProbe(protocol: "REST" | "ICMP" | "FTP" | "TELNET"): ProbeFn {
  return async () => ({
    protocol,
    ok: true,
    timestamp: new Date().toISOString(),
    status: protocol === "ICMP" || protocol === "TELNET" ? 0 : 200,
    latencyMs: 1,
  });
}
