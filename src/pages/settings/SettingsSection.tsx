/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const OPEN_SECTIONS_KEY = "c64u_settings_open_sections";

const readOpenSections = (): Set<string> => {
  if (typeof localStorage === "undefined") return new Set();
  const raw = localStorage.getItem(OPEN_SECTIONS_KEY);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch (error) {
    console.warn(`Discarding unreadable stored Settings section state at ${OPEN_SECTIONS_KEY}`, error);
    return new Set();
  }
};

const writeOpenSection = (id: string, open: boolean): void => {
  if (typeof localStorage === "undefined") return;
  const ids = readOpenSections();
  if (open) ids.add(id);
  else ids.delete(id);
  localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify([...ids]));
};

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
  icon: Icon,
  defaultOpen = false,
  badge,
  testId,
  children,
}: SettingsSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const stored = readOpenSections();
    if (stored.size > 0 || !defaultOpen) setOpen(stored.has(id));
  }, [id, defaultOpen]);

  const toggle = useCallback(() => {
    setOpen((current) => {
      writeOpenSection(id, !current);
      return !current;
    });
  }, [id]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-testid={testId ?? `settings-section-${id}`}
      data-open={open ? "true" : "false"}
      data-section-label={title}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        data-testid={`settings-section-toggle-${id}`}
        aria-expanded={open}
        aria-controls={`settings-section-body-${id}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            {/* Still a real heading: the section titles are how the page is navigated, by a
                screen reader and by anyone scanning it. The badge sits beside the heading
                rather than inside it, so the heading's accessible name stays the title alone. */}
            <span className="flex items-center gap-2">
              <h2 className="font-medium">{title}</h2>
              {badge}
            </span>
            {/* Wrapped, not truncated: a summary cut off mid-word tells the reader less than
                no summary at all, and this page is read on a narrow screen. */}
            <span className="text-xs leading-snug text-muted-foreground">{summary}</span>
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} aria-hidden>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={`settings-section-body-${id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className={cn("space-y-4 border-t border-border px-4 py-4")}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
};
