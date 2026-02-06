export type DiagnosticsTabKey = 'error-logs' | 'logs' | 'traces' | 'actions';

const DIAGNOSTICS_OPEN_KEY = 'c64u_diagnostics_open_tab';

export const requestDiagnosticsOpen = (tab: DiagnosticsTabKey) => {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(DIAGNOSTICS_OPEN_KEY, tab);
    } catch (error) {
        console.warn('Unable to persist diagnostics open request:', error);
    }
    window.dispatchEvent(new CustomEvent('c64u-diagnostics-open-request', { detail: { tab } }));
};

export const consumeDiagnosticsOpenRequest = (): DiagnosticsTabKey | null => {
    if (typeof window === 'undefined') return null;
    try {
        const tab = sessionStorage.getItem(DIAGNOSTICS_OPEN_KEY) as DiagnosticsTabKey | null;
        if (tab) {
            sessionStorage.removeItem(DIAGNOSTICS_OPEN_KEY);
            return tab;
        }
    } catch (error) {
        console.warn('Unable to consume diagnostics open request:', error);
    }
    return null;
};
