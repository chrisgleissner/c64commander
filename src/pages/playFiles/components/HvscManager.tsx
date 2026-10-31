/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HvscLibraryState } from "../hooks/useHvscLibrary";
import { HVSC_CANCELED_STATUS_REASON } from "@/lib/hvsc/hvscCancellation";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { HvscControls } from "./HvscControls";

interface HvscManagerProps {
  hvscControlsEnabled: boolean;
  hvsc: HvscLibraryState;
  /** Opens the preparation sheet, which in SID Player asks before the first download. */
  onOpenPreparation?: () => void;
}

export function HvscManager({ hvscControlsEnabled, hvsc, onOpenPreparation }: HvscManagerProps) {
  const { formatHvscDuration, formatHvscTimestamp } = hvsc;
  const sidPlayer = useAppMode() === "sid-player";
  const canceled =
    hvsc.hvscPreparationState === "ERROR" && hvsc.hvscPreparationErrorReason === HVSC_CANCELED_STATUS_REASON;
  const asksFirst = sidPlayer && (hvsc.hvscPreparationState === "NOT_PRESENT" || canceled) && onOpenPreparation;

  if (!hvscControlsEnabled) {
    return null;
  }

  return (
    <HvscControls
      hvscInstalledVersion={hvsc.hvscStatus?.installedVersion ?? null}
      hvscAvailable={hvsc.hvscAvailable}
      hvscUpdating={hvsc.hvscUpdating}
      hvscInProgress={hvsc.hvscInProgress}
      hvscCanIngest={hvsc.hvscCanIngest}
      hvscPreparationState={hvsc.hvscPreparationState}
      hvscPreparationStatusLabel={hvsc.hvscPreparationStatusLabel}
      hvscStage={hvsc.hvscStage}
      hvscStageStep={hvsc.hvscStageStep}
      hvscStagePercent={hvsc.hvscStagePercent}
      hvscStageDone={hvsc.hvscStageDone}
      hvscStageTotal={hvsc.hvscStageTotal}
      hvscPreparationThroughputLabel={hvsc.hvscPreparationThroughputLabel}
      hvscAnalyzing={hvsc.hvscAnalyzing}
      hvscPreparationErrorReason={hvsc.hvscPreparationErrorReason}
      hvscPreparationFailedPhase={hvsc.hvscPreparationFailedPhase}
      hvscReadySongCount={hvsc.hvscReadySongCount}
      hvscSummaryFilesExtracted={hvsc.hvscSummaryFilesExtracted}
      hvscSummaryDurationMs={hvsc.hvscSummaryDurationMs}
      hvscSummaryUpdatedAt={hvsc.hvscSummaryUpdatedAt}
      hvscMetadataProgressLabel={hvsc.hvscMetadataProgressLabel}
      hvscMetadataUpdatedAt={hvsc.hvscMetadataUpdatedAt}
      hvscSonglengthSyntaxErrors={hvsc.hvscSonglengthSyntaxErrors}
      formatHvscDuration={formatHvscDuration}
      formatHvscTimestamp={formatHvscTimestamp}
      onInstall={() => (asksFirst ? onOpenPreparation() : void hvsc.handleHvscInstall())}
      onIngest={() => void hvsc.handleHvscIngest()}
      onCancel={() => void hvsc.handleHvscCancel()}
      onReindex={() => void hvsc.handleHvscReindex()}
      onReset={() => void hvsc.handleHvscReset()}
    />
  );
}
