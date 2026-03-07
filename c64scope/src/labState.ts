import { z } from "zod";

export type PeerHealthLevel = "healthy" | "degraded" | "unavailable" | "unknown";

export type PeerName = "mobile_controller" | "c64bridge" | "capture_infrastructure";

const peerHealthSchema = z.object({
  peer: z.enum(["mobile_controller", "c64bridge", "capture_infrastructure"]),
  level: z.enum(["healthy", "degraded", "unavailable", "unknown"]),
  detail: z.string(),
  reportedAt: z.string(),
});

export type PeerHealth = z.infer<typeof peerHealthSchema>;

export interface LabReadiness {
  ready: boolean;
  peers: Record<PeerName, PeerHealth>;
  degradedReasons: string[];
}

const PEER_NAMES: readonly PeerName[] = ["mobile_controller", "c64bridge", "capture_infrastructure"] as const;

export class LabStateStore {
  private readonly peers = new Map<PeerName, PeerHealth>();

  reportPeerHealth(peer: PeerName, level: PeerHealthLevel, detail: string): PeerHealth {
    const report: PeerHealth = peerHealthSchema.parse({
      peer,
      level,
      detail,
      reportedAt: new Date().toISOString(),
    });
    this.peers.set(peer, report);
    return report;
  }

  getPeerHealth(peer: PeerName): PeerHealth {
    return (
      this.peers.get(peer) ?? {
        peer,
        level: "unknown" as const,
        detail: "No health report received.",
        reportedAt: new Date().toISOString(),
      }
    );
  }

  checkReadiness(): LabReadiness {
    const peers = {} as Record<PeerName, PeerHealth>;
    const degradedReasons: string[] = [];

    for (const name of PEER_NAMES) {
      const health = this.getPeerHealth(name);
      peers[name] = health;
      if (health.level === "unavailable") {
        degradedReasons.push(`${name}: unavailable — ${health.detail}`);
      } else if (health.level === "degraded") {
        degradedReasons.push(`${name}: degraded — ${health.detail}`);
      } else if (health.level === "unknown") {
        degradedReasons.push(`${name}: unknown — no health report received`);
      }
    }

    return { ready: degradedReasons.length === 0, peers, degradedReasons };
  }

  reset(): void {
    this.peers.clear();
  }
}
