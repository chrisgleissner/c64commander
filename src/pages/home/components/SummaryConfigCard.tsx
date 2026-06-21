/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
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
      className="bg-card border border-border rounded-xl p-3 space-y-2 outline-none"
      data-section-label={sectionLabel}
      data-testid={testId}
      tabIndex={focusId ? -1 : undefined}
    >
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">{title}</p>
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center justify-end">
          <Checkbox
            ref={focusRef}
            checked={checked}
            onCheckedChange={(nextValue) => onValueChange(nextValue === true ? enabledValue : disabledValue)}
            disabled={disabled}
            className="h-4 w-4"
            aria-label={label}
            data-testid={testId}
          />
        </div>
      </div>
    );
  }

  const selectOptions = normalizeSelectOptions(normalizedOptions, value);
  const selectValue = normalizeSelectValue(value);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <Select
        value={selectValue}
        onValueChange={(nextValue) => onValueChange(resolveSelectValue(nextValue))}
        disabled={disabled}
      >
        <SelectTrigger ref={focusRef} className={selectTriggerClassName} data-testid={testId}>
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
