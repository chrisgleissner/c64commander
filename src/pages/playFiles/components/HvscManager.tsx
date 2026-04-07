/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HvscLibraryState } from "../hooks/useHvscLibrary";
import { HvscControls } from "./HvscControls";

interface HvscManagerProps {
  hvscControlsEnabled: boolean;
  hvsc: HvscLibraryState;
}

export function HvscManager({ hvscControlsEnabled, hvsc }: HvscManagerProps) {
  const { formatHvscDuration, formatHvscTimestamp } = hvsc;

  if (!hvscControlsEnabled) {
    return null;
  }

  return (
    <HvscControls
      hvscInstalledVersion={hvsc.hvscStatus?.installedVersion ?? null}
      hvscAvailable={hvsc.hvscAvailable}
      hvscUpdating={hvsc.hvscUpdating}
      hvscCanIngest={hvsc.hvscCanIngest}
      hvscPreparationState={hvsc.hvscPreparationState}
      hvscPreparationStatusLabel={hvsc.hvscPreparationStatusLabel}
      hvscPreparationProgressPercent={hvsc.hvscPreparationProgressPercent}
      hvscPreparationThroughputLabel={hvsc.hvscPreparationThroughputLabel}
      hvscPreparationErrorReason={hvsc.hvscPreparationErrorReason}
      hvscReadySongCount={hvsc.hvscReadySongCount}
      hvscSummaryFilesExtracted={hvsc.hvscSummaryFilesExtracted}
      hvscSummaryDurationMs={hvsc.hvscSummaryDurationMs}
      hvscSummaryUpdatedAt={hvsc.hvscSummaryUpdatedAt}
      hvscMetadataProgressLabel={hvsc.hvscMetadataProgressLabel}
      hvscMetadataUpdatedAt={hvsc.hvscMetadataUpdatedAt}
      hvscSonglengthSyntaxErrors={hvsc.hvscSonglengthSyntaxErrors}
      formatHvscDuration={formatHvscDuration}
      formatHvscTimestamp={formatHvscTimestamp}
      onReindex={() => void hvsc.handleHvscReindex()}
      onReset={() => void hvsc.handleHvscReset()}
    />
  );
}
