/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Wifi, Settings, Play, Home, Disc, Sliders, Activity, type LucideIcon } from "lucide-react";
import { AppBar } from "@/components/AppBar";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { PageContainer } from "@/components/layout/PageContainer";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { getDocsExternalResourceLinks } from "@/lib/docs/externalResources";
import { SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import { variant } from "@/generated/variant";
import { TourRestartCard } from "@/components/tour/TourRestartCard";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import type { FeatureFlags } from "@/lib/config/featureFlags";

interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  content: React.ReactNode;
}

const buildDocSections = (flags: FeatureFlags): DocSection[] => {
  return [
    {
      id: "getting-started",
      title: "Getting started",
      icon: Wifi,
      content: (
        <div className="space-y-3 text-sm">
          <p>
            Keep this device and your <strong>{SOURCE_LABELS.c64u}</strong> on the same network, with its network
            services enabled.
          </p>
          <p className="text-muted-foreground">
            Add your device in <strong>Settings</strong> → <strong>Connection</strong>, then{" "}
            <strong>Save & Connect</strong>.
          </p>
          <p className="text-muted-foreground">
            The header badge shows connection health — tap it for Diagnostics, long-press to switch devices.
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
            Home is the main control page: status, machine controls, Quick Config, drives, printers, audio and config
            actions.
          </p>
        </div>
      ),
    },
    {
      id: "play",
      title: "Play files",
      icon: Play,
      content: (
        <div className="space-y-3 text-sm">
          <p>Play builds and runs your playlist. Supported files: SID, MOD, PRG, CRT, D64, G64, D71, G71, and D81.</p>
        </div>
      ),
    },
    {
      id: "disks",
      title: "Disks & drives",
      icon: Disc,
      content: (
        <div className="space-y-3 text-sm">
          <p>Disks manages drive state and the disk collection used for mounting.</p>
          <p className="text-muted-foreground">Supported disk images: D64, G64, D71, G71, D81.</p>
        </div>
      ),
    },
    {
      id: "disk-swapping",
      title: "Swapping disks",
      icon: Disc,
      content: (
        <div className="space-y-3 text-sm">
          <p>Use groups to rotate disks for multi-disk titles.</p>
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
            Shows the connected {SOURCE_LABELS.c64u}&apos;s full configuration tree — search to find a setting fast.
          </p>
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
            Device health, app activity and support data. Open it from Settings, the header badge, or a notification.
          </p>
        </div>
      ),
    },
  ];
};

function DocSectionCard({ section }: { section: DocSection }) {
  return (
    <CollapsibleSection
      scope="docs"
      id={section.id}
      title={section.title}
      icon={section.icon}
      testId={`docs-card-${section.id}`}
      toggleTestId={`docs-toggle-${section.id}`}
      bodyId={`docs-section-${section.id}`}
      onToggleClick={wrapUserEvent(() => {}, "toggle", "DocsSection", { title: section.title }, "DocsHeader")}
    >
      {section.content}
    </CollapsibleSection>
  );
}

export default function DocsPage() {
  const pageShellClassName = usePrimaryPageShellClassName();
  const { profile } = useDisplayProfile();
  const { flags } = useFeatureFlags();
  const docSections = useMemo(() => buildDocSections(flags), [flags]);
  const externalResourceLinks = getDocsExternalResourceLinks();
  // Widened to `string`: `variant.id` is generated as a single literal per build, so
  // comparing it directly against a different variant's literal is a compile error on
  // whichever variant was generated locally, the same reason getDocsExternalResourceLinks
  // above takes `variantId: string` rather than reading `variant.id`'s own narrow type.
  const variantId: string = variant.id;
  return (
    <div className={pageShellClassName}>
      <AppBar title="Docs" />

      {/* `py-6` overrides `.page-shell`'s own profile padding and `space-y-4` fixes the card
          gap at 16px, so this is the one page that opts out of the profile spacing. Both are
          kept where the page was tuned; on compact the profile's padding applies again. */}
      <PageContainer className={profile === "compact" ? "space-y-2" : "py-6 space-y-4"}>
        {/* First, because someone on Docs is looking for a way in and the tour is the shortest
            one. Restartable at any time, which is the point of section 8's D10. */}
        <TourRestartCard />

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

        {/* External Links. Omitted on c64u-remote: that edition's only external link is
            the C64U User Guide, already reachable from Settings -> About, so a whole
            standalone card for one duplicate link is not worth the space. */}
        {variantId !== "c64u-remote" && (
          <CollapsibleSection
            scope="docs"
            id="external-resources"
            title="External resources"
            summary={`Official device manuals and API references used by ${variant.displayName}.`}
            icon={ExternalLink}
            testId="docs-external-resources"
            // Closed on a first visit: these are references to other people's documentation, read
            // once if at all, and the page's own chapters are what a reader came for.
            defaultOpen={false}
          >
            <div className="space-y-2">
              {externalResourceLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center gap-2 text-sm text-primary hover:underline"
                  data-testid={link.testId}
                >
                  <ExternalLink className="h-4 w-4" />
                  {link.label}
                </a>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </PageContainer>
    </div>
  );
}
