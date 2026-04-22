import type { FeatureFlagSnapshot } from "@/lib/config/featureFlags";

type BackgroundExecutionDecision = {
  backgroundExecutionEnabled: boolean;
  backgroundExecutionActive: boolean;
  isPlaying: boolean;
  isPaused: boolean;
};

export const isBackgroundExecutionEnabled = ({ flags }: FeatureFlagSnapshot) =>
  Boolean(flags.background_execution_enabled);

export const shouldStartBackgroundExecution = ({
  backgroundExecutionEnabled,
  backgroundExecutionActive,
  isPlaying,
  isPaused,
}: BackgroundExecutionDecision) => backgroundExecutionEnabled && isPlaying && !isPaused && !backgroundExecutionActive;

export const shouldStopBackgroundExecution = ({
  backgroundExecutionEnabled,
  backgroundExecutionActive,
  isPlaying,
  isPaused,
}: BackgroundExecutionDecision) => backgroundExecutionActive && (!backgroundExecutionEnabled || !isPlaying || isPaused);

export const shouldSyncBackgroundExecutionDueAt = (
  backgroundExecutionEnabled: boolean,
  backgroundExecutionActive: boolean,
  isNativeAndroid: boolean,
) => backgroundExecutionEnabled && backgroundExecutionActive && isNativeAndroid;
