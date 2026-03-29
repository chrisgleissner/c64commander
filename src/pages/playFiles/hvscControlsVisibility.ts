import type { FeatureFlagSnapshot } from "@/lib/config/featureFlags";

export const shouldShowHvscControls = ({ flags }: FeatureFlagSnapshot) => Boolean(flags.hvsc_enabled);
