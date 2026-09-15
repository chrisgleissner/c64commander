/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useNavigate } from "react-router-dom";
import { Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { t } from "@/lib/i18n";
import { requestSectionOpen } from "@/lib/ui/collapsibleSectionStore";

/**
 * What stands where the machine Quick Actions do while nothing is connected (spec.md section 6.1).
 *
 * A wall of "Not available" reads as an app that is broken rather than one waiting for hardware, so
 * the offline arrangement puts the one thing there is to do in its place.
 */
export const ConnectC64Card = () => {
  const navigate = useNavigate();
  const { devices, selectedDeviceId } = useSavedDevices();
  // A device that has connected before is out of reach, not missing; the app connects to it again by itself.
  const knownDevice = Boolean(devices.find((device) => device.id === selectedDeviceId)?.lastSuccessfulConnectionAt);

  return (
    <section
      className="space-y-3 rounded-panel border border-border bg-card p-4"
      data-testid="home-connect-c64"
      data-section-label="Connect a C64"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Wifi className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        {knownDevice
          ? t("home.connect.awayTitle", "C64 Ultimate out of reach")
          : t("home.connect.title", "Connect a C64 Ultimate")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {knownDevice
          ? t(
              "home.connect.awayBody",
              "It connects again by itself once this device is back on its network. Everything above works without it.",
            )
          : t(
              "home.connect.body",
              "Keep this device and your C64 Ultimate on the same network, with its network services on. Everything above works without one.",
            )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            navigate("/settings");
            requestSectionOpen("settings", "connection");
          }}
          data-testid="home-connect-c64-setup"
          variant={knownDevice ? "outline" : "default"}
          className="min-h-11"
        >
          {knownDevice ? t("home.connect.settings", "Connection settings") : t("home.connect.setUp", "Set up a device")}
        </Button>
      </div>
    </section>
  );
};
