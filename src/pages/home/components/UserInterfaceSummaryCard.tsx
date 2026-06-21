/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSharedConfigActions } from "../hooks/ConfigActionsContext";
import { buildConfigKey, readItemOptions } from "../utils/HomeConfigUtils";
import { resolveHomeConfigOptions } from "../constants";
import { SummaryConfigCard, SummaryConfigControlRow } from "./SummaryConfigCard";

type UserInterfaceSummaryCardProps = {
  category: string;
  config: Record<string, unknown> | undefined;
  isActive: boolean;
  selectTriggerClassName: string;
  testIdPrefix: string;
};

export function UserInterfaceSummaryCard({
  category,
  config,
  isActive,
  selectTriggerClassName,
  testIdPrefix,
}: UserInterfaceSummaryCardProps) {
  const { configWritePending, resolveConfigValue, updateConfigValue } = useSharedConfigActions();
  const unavailableLabel = "Not available";

  const interfaceTypeOptions = readItemOptions(config, category, "Interface Type").map((value) => String(value));
  const navigationStyleOptions = readItemOptions(config, category, "Navigation Style").map((value) => String(value));
  const colorSchemeOptions = readItemOptions(config, category, "Color Scheme").map((value) => String(value));

  const interfaceTypeValue = String(resolveConfigValue(config, category, "Interface Type", unavailableLabel));
  const navigationStyleValue = String(resolveConfigValue(config, category, "Navigation Style", unavailableLabel));
  const colorSchemeValue = String(resolveConfigValue(config, category, "Color Scheme", unavailableLabel));

  const effectiveInterfaceTypeOptions = resolveHomeConfigOptions(
    category,
    "Interface Type",
    interfaceTypeOptions,
    interfaceTypeValue,
  );
  const effectiveNavigationStyleOptions = resolveHomeConfigOptions(
    category,
    "Navigation Style",
    navigationStyleOptions,
    navigationStyleValue,
  );
  const effectiveColorSchemeOptions = resolveHomeConfigOptions(
    category,
    "Color Scheme",
    colorSchemeOptions,
    colorSchemeValue,
  );

  const displayedInterfaceTypeValue = isActive ? interfaceTypeValue : unavailableLabel;
  const displayedNavigationStyleValue = isActive ? navigationStyleValue : unavailableLabel;
  const displayedColorSchemeValue = isActive ? colorSchemeValue : unavailableLabel;

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
