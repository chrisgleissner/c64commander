/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §14 — Secondary detail view for firmware, FPGA, core, and uptime.
// Shown as an inline expansion within the diagnostics overlay.

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DeviceDetailInfo = {
  firmware: string | null;
  fpga: string | null;
  core: string | null;
  /** null = JIFFY data not available */
  uptimeSeconds: number | null;
  product: string | null;
};

type Props = {
  info: DeviceDetailInfo | null;
  onBack: () => void;
};

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${remainMinutes}m`;
};

const DetailRow = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div className="flex items-baseline justify-between gap-4 py-0.5">
    <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
    <span className="text-xs font-mono text-right truncate">
      {value ?? <span className="italic text-muted-foreground">—</span>}
    </span>
  </div>
);

export function DeviceDetailView({ info, onBack }: Props) {
  const uptime = info?.uptimeSeconds != null ? formatUptime(info.uptimeSeconds) : null;

  return (
    <div className="space-y-3" data-testid="device-detail-view">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          className="h-7 px-1.5 -ml-1.5"
          data-testid="device-detail-back"
          aria-label="Back to health summary"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground">Device Detail</h3>
      </div>

      {!info ? (
        <p className="text-xs text-muted-foreground">Run a health check to load device info.</p>
      ) : (
        <div className="rounded border border-border p-2 space-y-0.5">
          <DetailRow label="Product" value={info.product} />
          <DetailRow label="Firmware" value={info.firmware} />
          <DetailRow label="FPGA" value={info.fpga} />
          <DetailRow label="Core" value={info.core} />
          <DetailRow label="Uptime" value={uptime ?? (info.uptimeSeconds === null ? "JIFFY unavailable" : undefined)} />
        </div>
      )}
    </div>
  );
}
