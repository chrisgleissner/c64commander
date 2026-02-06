import { useEffect, useMemo, useState } from 'react';
import { getTraceEvents } from '@/lib/tracing/traceSession';
import { getDiagnosticsActivitySnapshot } from '@/lib/diagnostics/diagnosticsActivity';
import type { TraceEvent } from '@/lib/tracing/types';

type DiagnosticsActivitySnapshot = {
    restCount: number;
    ftpCount: number;
    errorCount: number;
    restInFlight: number;
    ftpInFlight: number;
};

const countEffects = (events: TraceEvent[]) => {
    let restCount = 0;
    let ftpCount = 0;
    let errorCount = 0;
    events.forEach((event) => {
        if (event.type === 'rest-response') restCount += 1;
        if (event.type === 'ftp-operation') ftpCount += 1;
        if (event.type === 'error') errorCount += 1;
    });
    return { restCount, ftpCount, errorCount };
};

export const useDiagnosticsActivity = (): DiagnosticsActivitySnapshot => {
    const [traceEvents, setTraceEvents] = useState(getTraceEvents);
    const [activity, setActivity] = useState(getDiagnosticsActivitySnapshot);

    useEffect(() => {
        const handleTracesUpdated = () => setTraceEvents(getTraceEvents());
        const handleActivityUpdated = () => setActivity(getDiagnosticsActivitySnapshot());

        window.addEventListener('c64u-traces-updated', handleTracesUpdated);
        window.addEventListener('c64u-activity-updated', handleActivityUpdated);

        return () => {
            window.removeEventListener('c64u-traces-updated', handleTracesUpdated);
            window.removeEventListener('c64u-activity-updated', handleActivityUpdated);
        };
    }, []);

    return useMemo(() => {
        const { restCount, ftpCount, errorCount } = countEffects(traceEvents);
        return {
            restCount,
            ftpCount,
            errorCount,
            restInFlight: activity.restInFlight,
            ftpInFlight: activity.ftpInFlight,
        };
    }, [traceEvents, activity]);
};
