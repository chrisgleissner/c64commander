/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Fragment, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink, Wifi, Settings, Play, Home, Disc, Sliders, Activity } from "lucide-react";
import { AppBar } from "@/components/AppBar";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { PageContainer } from "@/components/layout/PageContainer";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { getDocsExternalResourceLinks } from "@/lib/docs/externalResources";
import { SOURCE_EXPLANATIONS, SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import { variant } from "@/generated/variant";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import type { FeatureFlags } from "@/lib/config/featureFlags";

interface DocSection {
  id: string;
  title: string;
  icon: React.ElementType;
  content: React.ReactNode;
}

const renderStrongList = (labels: readonly string[]) =>
  labels.map((label, index) => (
    <Fragment key={label}>
      {index === 0 ? "" : index === labels.length - 1 ? " or " : ", "}
      <strong>{label}</strong>
    </Fragment>
  ));

const compactLabels = (labels: Array<string | null>): string[] =>
  labels.filter((label): label is string => label !== null);

const buildDocSections = (flags: FeatureFlags): DocSection[] => {
  const playSources = compactLabels([
    SOURCE_LABELS.local,
    SOURCE_LABELS.c64u,
    flags.hvsc_enabled ? SOURCE_LABELS.hvsc : null,
    flags.commoserve_enabled ? SOURCE_LABELS.commoserve : null,
  ]);
  const diskSources = compactLabels([
    SOURCE_LABELS.local,
    SOURCE_LABELS.c64u,
    flags.commoserve_enabled ? SOURCE_LABELS.commoserve : null,
  ]);
  return [
    {
      id: "getting-started",
      title: "Getting Started",
      icon: Wifi,
      content: (
        <div className="space-y-3 text-sm">
          <p>
            {variant.displayName} uses REST for control and FTP for files. Keep this device and your{" "}
            <strong>{SOURCE_LABELS.c64u}</strong> on the same network, with network services enabled on the{" "}
            {SOURCE_LABELS.c64u}.
          </p>
          <p className="font-medium">Connect in 4 steps:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              Open <strong>Settings</strong> → <strong>Connection</strong>.
            </li>
            <li>Enter the {SOURCE_LABELS.c64u} hostname or IP address, or use device discovery.</li>
            <li>Enter the network password if your device uses one.</li>
            <li>
              Tap <strong>Save & Connect</strong>.
            </li>
          </ol>
          <p className="text-muted-foreground">
            The header badge shows connection health. Tap it for Diagnostics. Long-press it to switch or edit the active
            saved device. To scan again, use <strong>Settings</strong> → <strong>Connection</strong> →{" "}
            <strong>Device discovery</strong>.
          </p>
          {flags.demo_mode_enabled ? (
            <p className="text-muted-foreground">
              Automatic Demo Mode can offer a simulated device when discovery does not find real hardware.
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "home",
      title: "Home",
      icon: Home,
      content: (
        <div className="space-y-3 text-sm">
          <p>
            Home is the main control page. It brings together system status, machine controls, Quick Config, drives,
            printers, audio, streams when supported, and config actions.
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>
              <strong>Reset</strong>, <strong>Reboot</strong>, <strong>Pause/Resume</strong>, and <strong>Menu</strong>{" "}
              control the running session.
            </li>
            {flags.ram_snapshots_enabled ? (
              <li>
                <strong>Save RAM</strong> and <strong>Load RAM</strong> capture or restore RAM snapshots.
              </li>
            ) : null}
            <li>
              <strong>Power Off</strong> appears only on devices that report power-control support.
            </li>
            {flags.home_telnet_power_cycle_enabled ? (
              <li>
                <strong>Power Cycle</strong> appears when the device supports it and Telnet is available.
              </li>
            ) : null}
            {flags.home_telnet_clear_ram_reboot_enabled ? (
              <li>
                <strong>Reboot (Clr Mem)</strong> appears when Telnet can run that device-menu action.
              </li>
            ) : null}
            {flags.home_telnet_reu_snapshot_enabled ? (
              <li>
                <strong>Save REU</strong> and REU restore entries appear when native storage and Telnet support them.
              </li>
            ) : null}
            <li>
              Quick Config edits common CPU, RAM, port, video, interface, and lighting settings. Changes apply
              immediately.
            </li>
            <li>
              Drive cards show state plus mount, eject, reset, and on/off actions. Printer cards show state and
              available printer controls.
            </li>
            {flags.home_telnet_drive_actions_enabled || flags.home_telnet_printer_actions_enabled ? (
              <li>
                Telnet shortcuts add device-menu actions such as Set dir, Turn on, Flush/Eject, and Reset when the
                connected device supports them.
              </li>
            ) : null}
            <li>
              The Config section saves to flash, loads from flash, resets to defaults, manages app-stored configs, and
              reverts unsaved changes.
            </li>
            {flags.home_telnet_config_actions_enabled ? (
              <li>
                Advanced config actions add Save to File, Load from File, and Clear Flash when native storage and Telnet
                are available.
              </li>
            ) : null}
            {flags.lighting_studio_enabled ? (
              <li>Lighting Studio adds Studio, Hold look, and Why this look controls.</li>
            ) : null}
          </ul>
        </div>
      ),
    },
    {
      id: "play",
      title: "Play Files",
      icon: Play,
      content: (
        <div className="space-y-3 text-sm">
          <p>Play builds and runs your playlist. Supported files: SID, MOD, PRG, CRT, D64, G64, D71, G71, and D81.</p>
          <p className="font-medium">Add and play files:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              Open <strong>Play</strong> and tap <strong>Add items</strong>.
            </li>
            <li>Choose a source: {renderStrongList(playSources)}.</li>
            <li>
              Source names: <strong>{SOURCE_LABELS.local}</strong> = {SOURCE_EXPLANATIONS.local},{" "}
              <strong>{SOURCE_LABELS.c64u}</strong> = {SOURCE_EXPLANATIONS.c64u}
              {flags.hvsc_enabled ? (
                <>
                  , <strong>{SOURCE_LABELS.hvsc}</strong> = {SOURCE_EXPLANATIONS.hvsc}
                </>
              ) : null}
              {flags.commoserve_enabled ? (
                <>
                  , <strong>{SOURCE_LABELS.commoserve}</strong> = {SOURCE_EXPLANATIONS.commoserve}
                </>
              ) : null}
              .
            </li>
            <li>
              {flags.commoserve_enabled ? "Browse folders or search CommoServe" : "Browse folders"}, select files or
              folders, then confirm.
            </li>
            <li>Start playback from the playlist or a single item.</li>
          </ol>
          <p className="font-medium">Playback controls:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Use play, pause, stop, previous/next, shuffle, repeat, and View all.</li>
            <li>For multi-song SID files, choose the song number and see duration when known.</li>
            <li>Songlengths metadata fills durations when available.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "disks",
      title: "Disks & Drives",
      icon: Disc,
      content: (
        <div className="space-y-3 text-sm">
          <p>Disks manages drive state and the disk collection used for mounting.</p>
          <p className="font-medium">Mount disks:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              Open <strong>Disks</strong>.
            </li>
            <li>
              In a Drive card header, tap the <strong>disk icon</strong>.
            </li>
            <li>Mount a disk from the collection, or add disks first.</li>
          </ol>
          <p className="font-medium">Add disks:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>
              Tap <strong>Add disks</strong> and pick a source: {renderStrongList(diskSources)}.
            </li>
            <li>The picker accepts folders and disk images. Supported disk images: D64, G64, D71, G71, and D81.</li>
            <li>
              Use <strong>View all</strong> to search, select, and manage large collections.
            </li>
            <li>Disk menus show details, config status, Set group, Rename disk, and Remove actions.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "disk-swapping",
      title: "Swapping Disks",
      icon: Disc,
      content: (
        <div className="space-y-3 text-sm">
          <p>Use groups to rotate disks for multi-disk titles.</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>
              <strong>Set group</strong> assigns a disk to a named rotation group.
            </li>
            <li>Drive-row rotate arrows cycle through disks in the mounted disk's group.</li>
            <li>
              The drive header <strong>disk icon</strong> opens mount and eject actions.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: "config",
      title: "Config",
      icon: Sliders,
      content: (
        <div className="space-y-3 text-sm">
          <p>
            Config shows the connected {SOURCE_LABELS.c64u} configuration tree. Use search to find settings quickly.
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Editable controls update the device immediately.</li>
            <li>
              To keep changes after restart, use Home → Config → <strong>Save</strong> <span>To flash</span>.
            </li>
            <li>
              Menu-backed settings are grouped into pages. REST-only settings remain visible in advanced sections.
            </li>
            <li>Home's Audio Mixer includes SID socket and UltiSID volume controls, with mute and solo.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "settings",
      title: "Settings",
      icon: Settings,
      content: (
        <div className="space-y-3 text-sm">
          <p>Settings controls app behavior, connection details, diagnostics, and safety limits.</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>
              <strong>Appearance</strong> sets theme, display profile, full screen, orientation, and navigation-bar
              options.
            </li>
            <li>
              <strong>Connection</strong> manages saved devices, host, ports, password, discovery, and Save & Connect.
            </li>
            <li>
              <strong>Diagnostics</strong> opens diagnostics, controls debug logging, and imports or exports
              non-sensitive settings.
            </li>
            <li>
              <strong>Play and Disk</strong> sets list preview size and disk first-PRG load mode.
            </li>
            <li>Feature flags are grouped under Stable Features and Experimental Features.</li>
            {flags.hvsc_enabled ? (
              <li>
                <strong>HVSC</strong> sets the mirror URL override and automatic update-check interval.
              </li>
            ) : null}
            {flags.commoserve_enabled ? (
              <li>
                <strong>Online Archive</strong> sets CommoServe host and header overrides, and opens the archive
                browser.
              </li>
            ) : null}
            <li>
              <strong>Device Safety</strong> sets concurrency, cache windows, cooldowns, backoff, circuit breaker
              behavior, and slider preview pacing.
            </li>
            <li>
              <strong>Notifications</strong> controls notification visibility and duration.
            </li>
            <li>
              <strong>About</strong> shows build details, documentation links, open-source licenses, and developer mode
              status.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      icon: Activity,
      content: (
        <div className="space-y-3 text-sm">
          <p>
            Diagnostics shows device health, app activity, and support data. Open it from Settings, the header badge,
            notifications, or a diagnostics route.
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>
              <strong>Overview</strong> keeps Problems, Actions, Logs, Errors, and Traces in one place.
            </li>
            <li>
              <strong>Health Check Detail</strong> shows REST, FTP, CONFIG, RASTER, and JIFFY probes, plus latency
              percentiles and the overall result. Telnet activity appears when Telnet actions run.
            </li>
            <li>Expanded rows show payload details without leaving the sheet.</li>
            <li>
              <strong>Actions</strong> summarizes user operations, targets, outcomes, and latency hints.
            </li>
            <li>
              <strong>Traces</strong> lists REST, FTP, and Telnet operations with timing and status.
            </li>
            <li>
              <strong>Logs</strong> captures app and device communication events. <strong>Errors</strong> lists error
              reports with context.
            </li>
            <li>
              Tools include Config Drift, Decision State, Latency, Health History, REST Heat Map, FTP Heat Map, and
              Config Heat Map. Contributor filters include App, REST, FTP, and Telnet.
            </li>
          </ul>
          <p className="text-muted-foreground">
            Deep links: <strong>/diagnostics</strong>, <strong>/diagnostics/latency</strong>,{" "}
            <strong>/diagnostics/history</strong>, <strong>/diagnostics/config-drift</strong>,{" "}
            <strong>/diagnostics/decision-state</strong>, <strong>/diagnostics/heatmap/rest</strong>,{" "}
            <strong>/diagnostics/heatmap/ftp</strong>, and <strong>/diagnostics/heatmap/config</strong>. Closing a
            deep-linked diagnostics view returns to Settings.
          </p>
          <p className="text-muted-foreground">
            Use filters to narrow results. <strong>Run health check</strong> refreshes device status.{" "}
            <strong>Clear</strong> resets local diagnostics data. <strong>Share</strong> exports a diagnostic bundle.
          </p>
        </div>
      ),
    },
  ];
};

function DocSectionCard({ section }: { section: DocSection }) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = section.icon;
  const contentId = `docs-section-${section.id}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
      data-testid={`docs-card-${section.id}`}
    >
      <button
        onClick={wrapUserEvent(
          () => setIsOpen(!isOpen),
          "toggle",
          "DocsSection",
          { title: section.title },
          "DocsHeader",
        )}
        className="w-full flex items-center justify-between p-4 text-left"
        aria-expanded={isOpen}
        aria-controls={contentId}
        data-testid={`docs-toggle-${section.id}`}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <span className="font-medium">{section.title}</span>
        </div>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={contentId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-border p-4">{section.content}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function DocsPage() {
  const pageShellClassName = usePrimaryPageShellClassName();
  const { flags } = useFeatureFlags();
  const docSections = useMemo(() => buildDocSections(flags), [flags]);
  const externalResourceLinks = getDocsExternalResourceLinks();
  return (
    <div className={pageShellClassName}>
      <AppBar title="Docs" />

      <PageContainer className="py-6 space-y-4">
        {docSections.map((section, index) => (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <DocSectionCard section={section} />
          </motion.div>
        ))}

        {/* External Links */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: docSections.length * 0.05 }}
          className="bg-card border border-border rounded-xl p-4 space-y-3"
          data-testid="docs-external-resources"
        >
          <h3 className="font-medium">External Resources</h3>
          <p className="text-sm text-muted-foreground">
            Official device manuals and API references used by {variant.displayName}.
          </p>
          <div className="space-y-2">
            {externalResourceLinks.map((link) => (
              <a
                key={link.id}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
                data-testid={link.testId}
              >
                <ExternalLink className="h-4 w-4" />
                {link.label}
              </a>
            ))}
          </div>
        </motion.div>
      </PageContainer>
    </div>
  );
}
