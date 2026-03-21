/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useHvscLibrary } from "../hooks/useHvscLibrary";
import { HvscControls } from "./HvscControls";
import { formatBytes } from "../playFilesUtils";

interface HvscManagerProps {
  hvscControlsEnabled: boolean;
}

export function HvscManager({ hvscControlsEnabled }: HvscManagerProps) {
  const hvsc = useHvscLibrary();
  const { formatHvscDuration, formatHvscTimestamp } = hvsc;

  if (!hvscControlsEnabled) {
    return null;
  }

  return (
    <HvscControls
      hvscInstalled={hvsc.hvscInstalled}
      hvscAvailable={hvsc.hvscAvailable}
      hvscUpdating={hvsc.hvscUpdating}
      hvscInProgress={hvsc.hvscInProgress}
      hvscCanIngest={hvsc.hvscCanIngest}
      hvscPhase={hvsc.hvscPhase}
      hvscSummaryState={hvsc.hvscSummaryState}
      hvscSummaryFilesExtracted={hvsc.hvscSummaryFilesExtracted}
      hvscSummaryDurationMs={hvsc.hvscSummaryDurationMs}
      hvscSummaryUpdatedAt={hvsc.hvscSummaryUpdatedAt}
      hvscSummaryFailureLabel={hvsc.hvscSummaryFailureLabel}
      hvscIngestionTotalSongs={hvsc.hvscIngestionTotalSongs}
      hvscIngestionIngestedSongs={hvsc.hvscIngestionIngestedSongs}
      hvscIngestionFailedSongs={hvsc.hvscIngestionFailedSongs}
      hvscSonglengthSyntaxErrors={hvsc.hvscSonglengthSyntaxErrors}
      hvscActionLabel={hvsc.hvscActionLabel}
      hvscDownloadBytes={hvsc.hvscDownloadBytes}
      hvscDownloadElapsedMs={hvsc.hvscDownloadElapsedMs}
      hvscInlineError={hvsc.hvscInlineError}
      formatBytes={formatBytes}
      formatHvscDuration={formatHvscDuration}
      formatHvscTimestamp={formatHvscTimestamp}
      onInstall={() => void hvsc.handleHvscInstall()}
      onIngest={() => void hvsc.handleHvscIngest()}
      onCancel={() => void hvsc.handleHvscCancel()}
      onReset={hvsc.handleHvscReset}
    />
  );
}
