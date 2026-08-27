/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFocusGroup, useFocusItem } from "@/hooks/useFocusNavigation";
import {
  formatSelectOptionLabel,
  normalizeOptionToken,
  normalizeSelectOptions,
  normalizeSelectValue,
  resolveSelectValue,
  resolveToggleOption,
} from "../utils/uiLogic";

type SummaryConfigCardProps = {
  children: ReactNode;
  focusGroup?: string;
  focusId?: string;
  focusOrder?: number;
  sectionLabel?: string;
  testId: string;
  title: string;
  /** Skips the visible title line - for a card whose title is now owned by an outer
   * `CollapsibleSection` header, so this renders only the rows. The focus-group
   * registration (still keyed by `title`) and testid are unaffected. */
  hideTitle?: boolean;
};

type SummaryConfigControlRowProps = {
  controlType?: "auto" | "checkbox" | "select";
  disabled: boolean;
  label: string;
  focusGroup?: string;
  focusId?: string;
  focusOrder?: number;
  focusParentId?: string;
  onValueChange: (value: string) => void;
  options: string[];
  selectTriggerClassName: string;
  testId: string;
  toggleHints?: {
    enabled?: string[];
    disabled?: string[];
  };
  value: string;
};

export function SummaryConfigCard({
  children,
  focusId,
  focusOrder = 0,
  sectionLabel,
  testId,
  title,
  hideTitle = false,
}: SummaryConfigCardProps) {
  // A card is a focus GROUP: OK descends into its control rows, Back ascends.
  // (The old model overloaded dpadRight to descend; the controller now does this
  // automatically for any group with enabled children.)
  const focusRef = useFocusGroup<HTMLDivElement>({
    id: focusId ?? "",
    label: title,
    order: focusOrder,
  });

  return (
    <div
      ref={focusRef}
      className={
        hideTitle ? "space-y-2 outline-none" : "bg-card border border-border rounded-panel p-3 space-y-2 outline-none"
      }
      data-section-label={sectionLabel}
      data-testid={testId}
      tabIndex={focusId ? -1 : undefined}
    >
      {hideTitle ? null : <p className="text-xs font-semibold text-primary uppercase tracking-wider">{title}</p>}
      <div className="space-y-2 text-xs">{children}</div>
    </div>
  );
}

export function SummaryConfigControlRow({
  controlType = "auto",
  disabled,
  focusGroup = "home-controls",
  focusId,
  focusOrder = 0,
  focusParentId,
  label,
  onValueChange,
  options,
  selectTriggerClassName,
  testId,
  toggleHints,
  value,
}: SummaryConfigControlRowProps) {
  const focusRef = useFocusItem<HTMLButtonElement>({
    id: focusId ?? "",
    order: focusOrder,
    group: focusGroup,
    parentId: focusParentId,
    disabled,
  });
  const normalizedOptions = options.map((option) => String(option));
  const shouldRenderCheckbox = controlType === "checkbox" || (controlType === "auto" && normalizedOptions.length === 2);

  if (shouldRenderCheckbox) {
    const enabledValue = resolveToggleOption(normalizedOptions, true, toggleHints);
    const disabledValue = resolveToggleOption(normalizedOptions, false, toggleHints);
    const checked = normalizeOptionToken(value) === normalizeOptionToken(enabledValue);

    return (
      // The whole row is the target, not just the box. A 16px checkbox is under 3mm
      // across on a small phone panel, which is hard to hit and gives the keypad focus
      // ring almost nothing to draw around. Wrapping the row in a label means a press
      // anywhere along it toggles the checkbox, using the browser's own label
      // behaviour rather than a second click handler that could drift out of step.
      // `min-h-11` is the 44px WCAG 2.5.5 target size.
      <label className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <Checkbox
          ref={focusRef}
          checked={checked}
          onCheckedChange={(nextValue) => onValueChange(nextValue === true ? enabledValue : disabledValue)}
          disabled={disabled}
          className="h-5 w-5"
          aria-label={label}
          data-testid={testId}
        />
      </label>
    );
  }

  const selectOptions = normalizeSelectOptions(normalizedOptions, value);
  const selectValue = normalizeSelectValue(value);

  return (
    <div className="flex w-full items-center">
      <Select
        value={selectValue}
        onValueChange={(nextValue) => onValueChange(resolveSelectValue(nextValue))}
        disabled={disabled}
      >
        {/* The trigger spans the whole row and carries the label itself, rather than
            sitting beside it as a value-sized chip. Sized to its own text it came out
            as small as 17x17 CSS pixels on the smallest supported screen. A full-width
            row is easy to hit, and when the keypad focus ring lands on it there is a
            whole row of highlight to see rather than a couple of characters. */}
        <SelectTrigger
          ref={focusRef}
          // `flex-wrap`: the label sits on the same line as the value only while both fit. At the
          // largest Text size on a 320px screen "Analog" needed 134px against a 78px line and was
          // split after "Analo". Wrapping puts the value on its own line instead.
          className={cn(selectTriggerClassName, "min-h-11 w-full flex-wrap justify-between gap-2")}
          data-testid={testId}
        >
          <span className="text-muted-foreground">{label}</span>
          <SelectValue placeholder={value} />
        </SelectTrigger>
        <SelectContent>
          {selectOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {formatSelectOptionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
