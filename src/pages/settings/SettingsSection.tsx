/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

import { CollapsibleSection } from "@/components/CollapsibleSection";

export interface SettingsSectionProps {
  id: string;
  title: string;
  /** One line saying what is inside, so the page can be read without opening anything. */
  summary: string;
  icon: LucideIcon;
  /** Opened on a first visit. Reserved for the one section most visits are actually about. */
  defaultOpen?: boolean;
  /** Shown beside the title — a count, a state, or a warning that must be visible while closed. */
  badge?: ReactNode;
  /** Keeps a testid a section already had, so existing selectors and the CTA inventory hold. */
  testId?: string;
  children: ReactNode;
}

/**
 * One collapsible chapter of the Settings page.
 *
 * Settings had grown to a single scroll of every control the app owns, which is a list to
 * be endured rather than read. Closed, each section is one line of plain language saying
 * what it decides; open, it is exactly what it always was. Nothing is removed and nothing
 * moves — the change is only whether it is on screen before you have asked for it.
 *
 * Which sections are open is remembered, so a user who lives in one of them is not made to
 * open it again on every visit.
 */
export const SettingsSection = ({
  id,
  title,
  summary,
  icon,
  defaultOpen = false,
  badge,
  testId,
  children,
}: SettingsSectionProps) => (
  <CollapsibleSection
    scope="settings"
    id={id}
    title={title}
    summary={summary}
    icon={icon}
    defaultOpen={defaultOpen}
    badge={badge}
    testId={testId}
  >
    {children}
  </CollapsibleSection>
);
