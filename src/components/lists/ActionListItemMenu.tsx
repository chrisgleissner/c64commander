/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { useRef, useState } from "react";
import { MoreVertical, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PathWrap } from "@/components/PathWrap";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OPEN_FOCUS_ATTR } from "@/components/ui/interstitialFocus";
import { cn } from "@/lib/utils";
import type { ActionListItem, ActionListMenuItem } from "./SelectableActionList";

type MenuAction = Extract<ActionListMenuItem, { type: "action" }>;

export type ItemMenuBlock =
  | { kind: "details"; label: string | null; rows: { label: string; value: string }[] }
  | { kind: "actions"; entries: MenuAction[] };

/** Groups a row's menu entries the way the sheet draws them: each labelled run of details, then each run of actions. */
export const groupItemMenuEntries = (entries: readonly ActionListMenuItem[]): ItemMenuBlock[] => {
  const blocks: ItemMenuBlock[] = [];
  let current: ItemMenuBlock | null = null;
  for (const entry of entries) {
    if (entry.type === "separator") {
      current = null;
    } else if (entry.type === "label") {
      current = { kind: "details", label: entry.label, rows: [] };
      blocks.push(current);
    } else if (entry.type === "info") {
      if (current?.kind !== "details") {
        current = { kind: "details", label: null, rows: [] };
        blocks.push(current);
      }
      current.rows.push({ label: entry.label, value: entry.value });
    } else {
      if (current?.kind !== "actions") {
        current = { kind: "actions", entries: [] };
        blocks.push(current);
      }
      current.entries.push(entry);
    }
  }
  return blocks.filter((block) => (block.kind === "details" ? block.rows.length > 0 : block.entries.length > 0));
};

const withoutStraySeparators = (entries: readonly ActionListMenuItem[]): ActionListMenuItem[] =>
  entries.filter((entry, index) => {
    if (entry.type !== "separator") return true;
    const previous = entries[index - 1];
    const next = entries[index + 1];
    return previous !== undefined && previous.type !== "separator" && next !== undefined;
  });

/** Actions come first: on a short screen the details are read by scrolling, the actions are what the reader came for. */
export const orderActionsFirst = (entries: readonly ActionListMenuItem[]): ActionListMenuItem[] => {
  const actions = entries.filter((entry) => entry.type === "action");
  const details = withoutStraySeparators(entries.filter((entry) => entry.type !== "action"));
  return actions.length > 0 && details.length > 0
    ? [...actions, { type: "separator" }, ...details]
    : [...actions, ...details];
};

const keepMenuOpen = (event: Event) => event.preventDefault();

/** Events from the sheet's portal still bubble through React to the row, whose click plays the item. */
const stopAtRowBoundary = (event: React.SyntheticEvent) => event.stopPropagation();

type ActionListItemMenuProps = {
  item: ActionListItem;
  testId?: string;
  presentation: "dropdown" | "sheet";
};

const triggerClassName = "h-9 w-9 min-h-[44px] min-w-[44px]";

const ItemDetailsSheet = ({
  item,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  item: ActionListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: React.RefObject<HTMLButtonElement | null>;
}) => {
  const grouped = groupItemMenuEntries(item.menuItems ?? []);
  const blocks = [
    ...grouped.filter((block) => block.kind === "actions"),
    ...grouped.filter((block) => block.kind === "details"),
  ];
  const unavailable = Boolean(item.isDimmed || item.disableActions);
  const opensOnPrimary = Boolean(item.onAction) && !unavailable;
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };
  return (
    <div className="contents" onClick={stopAtRowBoundary} onPointerDown={stopAtRowBoundary}>
      <AppSheet open={open} onOpenChange={onOpenChange}>
        <AppSheetContent
          data-testid="action-list-item-sheet"
          // A sheet without a Radix trigger returns focus nowhere; the keypad ring needs it back on ⋮.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusTo.current?.focus({ preventScroll: true });
          }}
        >
          <AppSheetHeader>
            <AppSheetTitle className="leading-snug [overflow-wrap:anywhere]">{item.title}</AppSheetTitle>
            <AppSheetDescription>Details and actions for this item.</AppSheetDescription>
          </AppSheetHeader>
          <AppSheetBody className="space-y-3 px-4 py-3">
            {item.onAction ? (
              <Button
                className="w-full"
                disabled={unavailable}
                onClick={() => run(() => item.onAction?.())}
                aria-label={item.actionAriaLabel || `${item.actionLabel} ${item.title}`}
                data-testid="action-list-item-sheet-primary"
                {...(opensOnPrimary ? { [OPEN_FOCUS_ATTR]: "true" } : {})}
              >
                {item.actionIcon ?? <Play aria-hidden="true" />}
                {item.actionLabel}
              </Button>
            ) : null}
            {blocks.map((block, index) =>
              block.kind === "details" ? (
                <section
                  key={`details-${index}`}
                  aria-label={block.label ?? "Details"}
                  className="rounded-md border border-border/70 px-3 py-2"
                  data-testid="action-list-item-sheet-details"
                >
                  {block.label ? <h3 className="text-sm font-semibold">{block.label}</h3> : null}
                  <dl className="mt-1 flex flex-col">
                    {block.rows.map((row, rowIndex) => (
                      // Each row is a keypad stop, so stepping through the sheet scrolls every detail into view
                      // even when one block is taller than the sheet.
                      <div
                        key={`${row.label}-${rowIndex}`}
                        tabIndex={0}
                        {...(index === 0 &&
                        rowIndex === 0 &&
                        !opensOnPrimary &&
                        !blocks.some((entry) => entry.kind === "actions")
                          ? { [OPEN_FOCUS_ATTR]: "true" }
                          : {})}
                        className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-3 rounded-sm py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="action-list-item-sheet-detail-row"
                      >
                        <dt className="text-sm text-muted-foreground">{row.label}</dt>
                        <dd className="text-base [overflow-wrap:anywhere]" data-detail-label={row.label}>
                          <PathWrap path={row.value} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : (
                <div key={`actions-${index}`} className="flex flex-col gap-2">
                  {block.entries.map((entry, entryIndex) => (
                    <Button
                      key={entry.label}
                      {...(index === 0 && entryIndex === 0 && !opensOnPrimary ? { [OPEN_FOCUS_ATTR]: "true" } : {})}
                      variant="outline"
                      className={cn(
                        "w-full justify-start whitespace-normal text-left",
                        entry.destructive ? "text-destructive hover:text-destructive" : null,
                      )}
                      disabled={entry.disabled}
                      onClick={() => run(entry.onSelect)}
                    >
                      {entry.label}
                    </Button>
                  ))}
                </div>
              ),
            )}
          </AppSheetBody>
        </AppSheetContent>
      </AppSheet>
    </div>
  );
};

/**
 * A row's ⋮ control. On the compact profile it opens a bottom sheet: a dropdown anchored to a row
 * gets only the space between the row and the screen edge, which on a 427 px screen held three of
 * the fourteen entries. Elsewhere it stays a menu beside the row, which fits there.
 */
export const ActionListItemMenu = ({ item, testId, presentation }: ActionListItemMenuProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (presentation === "sheet") {
    return (
      <>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label="Item actions"
          data-key-nav-menu=""
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={item.disableActions}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          id={testId}
          data-testid={testId}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
        <ItemDetailsSheet item={item} open={open} onOpenChange={setOpen} returnFocusTo={triggerRef} />
      </>
    );
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label="Item actions"
          disabled={item.disableActions}
          onClick={(event) => {
            event.stopPropagation();
            // The trigger opens on pointer-down or its own Enter; the keypad ring activates it
            // with a click, which carries no pointer (detail 0) and would otherwise do nothing.
            if (event.detail === 0) setOpen(true);
          }}
          id={testId}
          data-testid={testId}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {item.menuItems?.length
          ? orderActionsFirst(item.menuItems).map((entry, index) => {
              if (entry.type === "separator") return <DropdownMenuSeparator key={`sep-${index}`} />;
              if (entry.type === "label") {
                return <DropdownMenuLabel key={`label-${index}`}>{entry.label}</DropdownMenuLabel>;
              }
              if (entry.type === "info") {
                // Not `disabled`: a menu's arrow keys skip disabled items, so on a keypad the
                // details could never be scrolled into view. OK on one leaves the menu open.
                return (
                  <DropdownMenuItem
                    key={`info-${index}`}
                    className="text-muted-foreground [overflow-wrap:anywhere]"
                    data-menu-detail="true"
                    onSelect={keepMenuOpen}
                  >
                    {entry.label}: {entry.value}
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem
                  key={`action-${index}`}
                  onSelect={entry.onSelect}
                  disabled={entry.disabled}
                  className={entry.destructive ? "text-destructive focus:text-destructive" : undefined}
                >
                  {entry.label}
                </DropdownMenuItem>
              );
            })
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
