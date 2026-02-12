import { useHvscLibrary } from '../hooks/useHvscLibrary';
import { HvscControls } from './HvscControls';
import { formatBytes } from '../playFilesUtils';

interface HvscManagerProps {
    hvscControlsEnabled: boolean;
}

export function HvscManager({
    hvscControlsEnabled,
}: HvscManagerProps) {
    const hvsc = useHvscLibrary();
    const {
        formatHvscDuration,
        formatHvscTimestamp,
    } = hvsc;

    if (!hvscControlsEnabled) {
        return null;
    }

    return (
        <HvscControls
            {...hvsc}
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
