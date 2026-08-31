/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { Button } from "@/components/ui/button";
import { HardDrive } from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { driveCardTitleVariants } from "@/lib/drives/driveDevices";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getOnOffButtonClass } from "@/lib/ui/buttonStyles";
import {
  getDiagnosticsColorClassForDisplaySeverity,
  type DiagnosticsDisplaySeverity,
} from "@/lib/diagnostics/diagnosticsSeverity";
import { INLINE_SUMMARY_CONTROL_CLASS } from "./inlineControlStyles";

export interface DriveCardProps {
  name: string;
  enabled: boolean;
  onToggle: () => void;
  togglePending?: boolean;

  busIdValue: string;
  busIdOptions: string[];
  onBusIdChange: (value: string) => void;
  busIdPending?: boolean;

  // For Physical Drives
  typeValue?: string;
  typeOptions?: string[];
  onTypeChange?: (value: string) => void;
  typePending?: boolean;

  // For Soft IEC
  pathValue?: string; // Deprecated, use mountedPath
  onPathClick?: () => void; // Deprecated, use onMountedPathClick
  pathPending?: boolean;

  // New props for mounted path
  mountedPath?: string;
  mountedPathLabel?: string;
  onMountedPathClick?: () => void;
  statusSummary: string;
  statusSeverity?: DiagnosticsDisplaySeverity;
  onStatusClick?: () => void;
  statusRaw?: string;

  isConnected: boolean;
  className?: string;
  testIdSuffix: string;
  /** Opened on a first visit. Only the primary drive sets this. */
  defaultOpen?: boolean;
  footer?: React.ReactNode;
  /**
   * When set, registers this drive's enable (ON/OFF) toggle into the keypad
   * focus ring (C64U Remote) so it is reachable by d-pad traversal and
   * center-activation. Inert in the default variant (no provider listener).
   */
  focusId?: string;
  /** Lower sorts earlier in keypad d-pad traversal. Defaults to 0. */
  focusOrder?: number;
}

const inlineSelectTriggerClass = INLINE_SUMMARY_CONTROL_CLASS;

export function DriveCard({
  name,
  enabled,
  onToggle,
  togglePending,
  busIdValue,
  busIdOptions,
  onBusIdChange,
  busIdPending,
  typeValue,
  typeOptions,
  onTypeChange,
  typePending,
  pathValue,
  onPathClick,
  pathPending,
  mountedPath,
  mountedPathLabel,
  onMountedPathClick,
  statusSummary,
  statusSeverity = "INFO",
  onStatusClick,
  statusRaw,
  isConnected,
  className,
  testIdSuffix,
  defaultOpen = false,
  footer,
  focusId,
  focusOrder = 0,
}: DriveCardProps) {
  const { profile } = useDisplayProfile();
  const formatSelectOptionLabel = (value: string) => (value === "" ? "Default" : value);
  // The enable toggle is registered as disabled while the toggle itself is
  // disabled (disconnected / pending) so the keypad ring skips it.
  const toggleFocusRef = useFocusItem<HTMLButtonElement>({
    id: focusId ?? "",
    order: focusOrder,
    group: "home-drives",
    disabled: !isConnected || Boolean(togglePending),
  });

  return (
    <CollapsibleSection
      scope="home"
      id={`drive-${testIdSuffix}`}
      title={name}
      titleVariants={driveCardTitleVariants(name)}
      icon={HardDrive}
      // The header already carries ON/OFF and mount; the tile would cost the title the room it needs.
      plainIcon
      className={className}
      testId={`home-drive-row-${testIdSuffix}`}
      defaultOpen={defaultOpen}
      // ON/OFF stays outside the body: whether a drive is powered is the one thing worth seeing,
      // and worth being able to change, without opening the card.
      actions={
        <Button
          ref={toggleFocusRef}
          variant="outline"
          size="sm"
          onClick={onToggle}
          disabled={!isConnected || togglePending}
          className={cn("px-3 text-xs", getOnOffButtonClass(enabled), "min-h-11 min-w-11")}
          data-testid={`home-drive-toggle-${testIdSuffix}`}
        >
          {enabled ? "ON" : "OFF"}
        </Button>
      }
    >
      {/* Row 1.5: Mounted Path.
          The row wraps, and the value is allowed the whole of it when it does. The drive cards sit
          two to a row, so this card is 147px wide on a 393px screen; with the label beside it the
          button had 57.7px for "No disk mounted", which needs 149px, and drew "No d…". The label
          taking its own line is the only way the value can be read at all here. */}
      {(mountedPath !== undefined || pathValue !== undefined) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="shrink-0 text-muted-foreground whitespace-nowrap">{mountedPathLabel || "Disk"}</span>
          <button
            type="button"
            onClick={onMountedPathClick || onPathClick}
            disabled={!isConnected || pathPending}
            className={cn(
              "min-h-11 min-w-0 flex-1 text-left font-medium text-foreground hover:underline",
              profile === "expanded" ? "basis-auto" : "basis-full",
              /*
               * A path is elided; a sentence wraps.
               *
               * Cutting the middle of a path still leaves it recognisable, and that is what
               * `truncate` is for here. "No disk mounted" and "Select..." are not paths — cutting
               * them gives "No d…", which says nothing — and this card is 147px wide because the
               * drives sit two to a row, so on the medium profile there is no width at which the
               * sentence fits on one line. `MountedLabel` in HomeDiskManager already draws this
               * same distinction for the row below.
               */
              (mountedPath ?? pathValue)?.includes("/") ? "truncate" : "whitespace-normal break-words",
            )}
            data-testid={`home-drive-mounted-${testIdSuffix}`}
          >
            {(mountedPath ?? pathValue) || "Select..."}
          </button>
        </div>
      )}

      {/* Row 2: Bus ID and Type.
          Two columns only where the card is actually wide enough for them. The drive cards sit two
          to a row, so on the medium profile a card is 147px and each of these cells got about 70px
          — a "Type" label and then 32px for its value against the 44px touch floor, which squeezed
          the trigger to exactly that floor and cut "1541" to 44px of the 47px it needs. It fitted
          before only because the floor was a rem that happened to be 49.5px there; sizing the floor
          honestly in pixels is what exposed the column count as the real problem. */}
      <div className={cn("grid gap-2 text-xs", profile === "expanded" ? "grid-cols-2" : "grid-cols-1")}>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-muted-foreground whitespace-nowrap">Bus ID</span>
          <Select value={busIdValue} onValueChange={onBusIdChange} disabled={!isConnected || busIdPending}>
            <SelectTrigger
              className={cn(
                inlineSelectTriggerClass,
                // Sized to its own content, not to the cell. `flex-1` gave these a basis of 0, so in
                // a narrow cell they shrank to the 44px touch floor and `overflow-hidden` cut the
                // rest — "1541" in a 44px box needing 47px on CI's wider fallback font. It fitted
                // before only because the floor was a rem that happened to be 49.5px there. These
                // values are short (a bus number, a drive type), so letting each keep its own width
                // costs the row nothing and cannot cut it.
                "min-h-11 min-w-11 shrink-0 justify-start",
              )}
              data-testid={`home-drive-bus-${testIdSuffix}`}
            >
              <SelectValue placeholder={busIdValue} />
            </SelectTrigger>
            <SelectContent>
              {busIdOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatSelectOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className={cn("flex items-center gap-2 min-w-0", profile === "compact" ? "justify-start" : "justify-end")}>
          {typeValue !== undefined && (
            <>
              <span className="shrink-0 text-muted-foreground whitespace-nowrap">Type</span>
              <Select value={typeValue} onValueChange={onTypeChange} disabled={!isConnected || typePending}>
                <SelectTrigger
                  className={cn(
                    inlineSelectTriggerClass,
                    // Sized to its own content, not to the cell. `flex-1` gave these a basis of 0, so in
                    // a narrow cell they shrank to the 44px touch floor and `overflow-hidden` cut the
                    // rest — "1541" in a 44px box needing 47px on CI's wider fallback font. It fitted
                    // before only because the floor was a rem that happened to be 49.5px there. These
                    // values are short (a bus number, a drive type), so letting each keep its own width
                    // costs the row nothing and cannot cut it.
                    "min-h-11 min-w-11 shrink-0 justify-start",
                  )}
                  data-testid={`home-drive-type-${testIdSuffix}`}
                >
                  <SelectValue placeholder={typeValue} />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions?.map((option) => (
                    <SelectItem key={option} value={option}>
                      {formatSelectOptionLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </div>

      {/* Row 3: Status (always shown) */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground whitespace-nowrap">Status</span>
        <button
          type="button"
          onClick={onStatusClick}
          disabled={!onStatusClick}
          className={cn(
            "min-h-11 flex-1 truncate text-left font-medium",
            onStatusClick ? "underline-offset-2 hover:underline" : "cursor-default",
            getDiagnosticsColorClassForDisplaySeverity(statusSeverity),
          )}
          data-testid={`home-drive-status-${testIdSuffix}`}
        >
          {statusSummary}
        </button>
      </div>

      {footer}
    </CollapsibleSection>
  );
}
