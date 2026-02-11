import { createContext, useContext, type ReactNode } from 'react';
import { useConfigActions } from './useConfigActions';

type ConfigActionsValue = ReturnType<typeof useConfigActions>;

const ConfigActionsContext = createContext<ConfigActionsValue | null>(null);

export function ConfigActionsProvider({ children }: { children: ReactNode }) {
    const actions = useConfigActions();
    return (
        <ConfigActionsContext.Provider value={actions}>
            {children}
        </ConfigActionsContext.Provider>
    );
}

export function useSharedConfigActions(): ConfigActionsValue {
    const context = useContext(ConfigActionsContext);
    if (!context) {
        throw new Error('useSharedConfigActions must be used within a ConfigActionsProvider');
    }
    return context;
}
