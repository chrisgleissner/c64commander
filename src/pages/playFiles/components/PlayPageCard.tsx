/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";

type PlayPageCardProps = {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  contentClassName?: string;
};

export const PlayPageCard = ({
  id,
  title,
  summary,
  icon,
  children,
  defaultOpen = false,
  testId,
  contentClassName = "space-y-4",
}: PlayPageCardProps) => (
  <CollapsibleSection
    scope="play"
    id={id}
    title={title}
    summary={summary}
    icon={icon}
    defaultOpen={defaultOpen}
    testId={testId}
  >
    <div className={contentClassName}>{children}</div>
  </CollapsibleSection>
);
