import type { FeatureFlagSnapshot } from "@/lib/config/featureFlags";
import type { HvscPreparationState } from "@/lib/hvsc";

export const shouldShowHvscControls = ({ flags }: FeatureFlagSnapshot) => Boolean(flags.hvsc_enabled);

export const shouldIncludeHvscSource = (snapshot: FeatureFlagSnapshot, hvscAvailable: boolean) =>
  hvscAvailable && shouldShowHvscControls(snapshot);

export const shouldOpenHvscPreparation = (
  snapshot: FeatureFlagSnapshot,
  sourceType: "hvsc" | string,
  preparationState: HvscPreparationState,
) => sourceType === "hvsc" && shouldShowHvscControls(snapshot) && preparationState !== "READY";

export const shouldCancelHvscLifecycleOnDisable = (hvscEnabled: boolean, preparationState: HvscPreparationState) =>
  !hvscEnabled && (preparationState === "DOWNLOADING" || preparationState === "INGESTING");

/**
 * Whether the open preparation sheet should start or continue the work by itself. A failed attempt
 * waits for the sheet's Retry button: starting again on its own repeated the failure in a loop.
 */
export const shouldAutoRunHvscPreparation = ({
  enabled,
  sheetOpen,
  updating,
  preparationState,
}: {
  enabled: boolean;
  sheetOpen: boolean;
  updating: boolean;
  preparationState: HvscPreparationState;
}) => enabled && sheetOpen && !updating && preparationState !== "READY" && preparationState !== "ERROR";
