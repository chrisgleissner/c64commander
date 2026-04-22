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
