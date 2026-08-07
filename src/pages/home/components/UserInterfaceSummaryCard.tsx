/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSharedConfigActions } from "../hooks/ConfigActionsContext";
import {
  buildConfigKey,
  readItemOptions,
  CONFIG_UNAVAILABLE_LABEL,
  resolveConfigDisplayValue,
} from "../utils/HomeConfigUtils";
import { resolveHomeConfigOptions } from "../constants";
import { buildOptionDomainKey, type DeviceConfigOptionDomains } from "../hooks/useDeviceConfigOptionDomains";
import { SummaryConfigCard, SummaryConfigControlRow } from "./SummaryConfigCard";

type UserInterfaceSummaryCardProps = {
  category: string;
  config: Record<string, unknown> | undefined;
  isActive: boolean;
  /**
   * False while the category read is still in flight.
   *
   * Required rather than defaulting to true: a default would let a new caller forget it and
   * silently reintroduce the defect this exists to fix, which is the one thing the prop is
   * for. Pass `isFetched` from the query, not `isSuccess` - `useC64ConfigItems` supplies
   * placeholderData from the persisted snapshot, and isSuccess is already true then.
   */
  hasLoaded: boolean;
  optionDomains?: DeviceConfigOptionDomains;
  selectTriggerClassName: string;
  testIdPrefix: string;
};

export function UserInterfaceSummaryCard({
  category,
  config,
  isActive,
  hasLoaded,
  optionDomains = {},
  selectTriggerClassName,
  testIdPrefix,
}: UserInterfaceSummaryCardProps) {
  const { configWritePending, resolveConfigValue, updateConfigValue } = useSharedConfigActions();
  const unavailableLabel = CONFIG_UNAVAILABLE_LABEL;

  const interfaceTypeOptions = readItemOptions(config, category, "Interface Type").map((value) => String(value));
  const navigationStyleOptions = readItemOptions(config, category, "Navigation Style").map((value) => String(value));
  const colorSchemeOptions = readItemOptions(config, category, "Color Scheme").map((value) => String(value));

  const interfaceTypeValue = String(resolveConfigValue(config, category, "Interface Type", unavailableLabel));
  const navigationStyleValue = String(resolveConfigValue(config, category, "Navigation Style", unavailableLabel));
  const colorSchemeValue = String(resolveConfigValue(config, category, "Color Scheme", unavailableLabel));

  // An outstanding read shows "…" rather than claiming the device does not have the item.
  // Resolved before the option lists below, because each list seeds itself with the current
  // value to guarantee the value is selectable - and seeding it with the raw value put
  // "Not available" back into the dropdown while the read was still in flight.
  const displayedInterfaceTypeValue = resolveConfigDisplayValue({ isActive, hasLoaded, value: interfaceTypeValue });
  const displayedNavigationStyleValue = resolveConfigDisplayValue({ isActive, hasLoaded, value: navigationStyleValue });
  const displayedColorSchemeValue = resolveConfigDisplayValue({ isActive, hasLoaded, value: colorSchemeValue });

  const effectiveInterfaceTypeOptions = resolveHomeConfigOptions(
    interfaceTypeOptions,
    optionDomains[buildOptionDomainKey(category, "Interface Type")]?.options,
    displayedInterfaceTypeValue,
  );
  const effectiveNavigationStyleOptions = resolveHomeConfigOptions(
    navigationStyleOptions,
    optionDomains[buildOptionDomainKey(category, "Navigation Style")]?.options,
    displayedNavigationStyleValue,
  );
  const effectiveColorSchemeOptions = resolveHomeConfigOptions(
    colorSchemeOptions,
    optionDomains[buildOptionDomainKey(category, "Color Scheme")]?.options,
    displayedColorSchemeValue,
  );

  const displayedColorSchemeOptions = isActive ? effectiveColorSchemeOptions : [unavailableLabel];

  const interfaceTypePending = Boolean(configWritePending[buildConfigKey(category, "Interface Type")]);
  const navigationStylePending = Boolean(configWritePending[buildConfigKey(category, "Navigation Style")]);
  const colorSchemePending = Boolean(configWritePending[buildConfigKey(category, "Color Scheme")]);

  return (
    <SummaryConfigCard
      sectionLabel="User Interface"
      title="User Interface"
      testId={`${testIdPrefix}-summary`}
      focusId={`${testIdPrefix}-summary`}
      focusOrder={530}
    >
      <SummaryConfigControlRow
        disabled={!isActive || interfaceTypePending}
        focusId={`${testIdPrefix}-overlay`}
        focusOrder={10}
        focusParentId={`${testIdPrefix}-summary`}
        label="Overlay"
        options={effectiveInterfaceTypeOptions}
        selectTriggerClassName={selectTriggerClassName}
        testId={`${testIdPrefix}-overlay`}
        toggleHints={{
          enabled: ["Overlay on HDMI", "Overlay"],
          disabled: ["Freeze"],
        }}
        value={displayedInterfaceTypeValue}
        onValueChange={(value) => {
          void updateConfigValue(category, "Interface Type", value, "HOME_USER_INTERFACE_OVERLAY", "Overlay updated");
        }}
      />
      <SummaryConfigControlRow
        disabled={!isActive || navigationStylePending}
        focusId={`${testIdPrefix}-wasd-cursors`}
        focusOrder={20}
        focusParentId={`${testIdPrefix}-summary`}
        label="WASD Cursors"
        options={effectiveNavigationStyleOptions}
        selectTriggerClassName={selectTriggerClassName}
        testId={`${testIdPrefix}-wasd-cursors`}
        toggleHints={{
          enabled: ["WASD Cursors"],
          disabled: ["Quick Search"],
        }}
        value={displayedNavigationStyleValue}
        onValueChange={(value) => {
          void updateConfigValue(
            category,
            "Navigation Style",
            value,
            "HOME_USER_INTERFACE_NAVIGATION",
            "Navigation style updated",
          );
        }}
      />
      <SummaryConfigControlRow
        disabled={!isActive || colorSchemePending}
        focusId={`${testIdPrefix}-color-scheme`}
        focusOrder={30}
        focusParentId={`${testIdPrefix}-summary`}
        label="Color Scheme"
        options={displayedColorSchemeOptions}
        selectTriggerClassName={selectTriggerClassName}
        testId={`${testIdPrefix}-color-scheme`}
        value={displayedColorSchemeValue}
        onValueChange={(value) => {
          void updateConfigValue(
            category,
            "Color Scheme",
            value,
            "HOME_USER_INTERFACE_COLOR_SCHEME",
            "Color scheme updated",
          );
        }}
      />
    </SummaryConfigCard>
  );
}
