import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActionTrace } from '@/hooks/useActionTrace';
import { getC64API } from '@/lib/c64api';
import { buildConfigKey, readItemValue } from '../utils/HomeConfigUtils';
import { reportUserError } from '@/lib/uiErrors';
import { toast } from '@/hooks/use-toast';

export function useConfigActions() {
    const api = getC64API();
    const queryClient = useQueryClient();
    const trace = useActionTrace();
    const [configOverrides, setConfigOverrides] = useState<Record<string, string | number>>({});
    const [configWritePending, setConfigWritePending] = useState<Record<string, boolean>>({});

    const updateConfigValue = trace(async function updateConfigValue(
        category: string,
        itemName: string,
        value: string | number,
        operation: string,
        successTitle: string,
        options: { refreshDrives?: boolean; suppressToast?: boolean } = {},
    ) {
        const key = buildConfigKey(category, itemName);
        const previousValue = configOverrides[key];
        setConfigOverrides((previous) => ({ ...previous, [key]: value }));
        setConfigWritePending((previous) => ({ ...previous, [key]: true }));
        try {
            await api.setConfigValue(category, itemName, value);
            if (!options.suppressToast) {
                toast({ title: successTitle });
            }
            await queryClient.invalidateQueries({
                predicate: (query) =>
                    Array.isArray(query.queryKey)
                    && query.queryKey[0] === 'c64-config-items'
                    && query.queryKey[1] === category,
            });
            if (options.refreshDrives) {
                await queryClient.fetchQuery({
                    queryKey: ['c64-drives'],
                    queryFn: () => api.getDrives(),
                    staleTime: 0,
                });
            }
        } catch (error) {
            setConfigOverrides((previous) => {
                const next = { ...previous };
                if (previousValue === undefined) {
                    delete next[key];
                } else {
                    next[key] = previousValue;
                }
                return next;
            });
            reportUserError({
                operation,
                title: 'Update failed',
                description: (error as Error).message,
                error,
                context: { category, item: itemName, value },
            });
        } finally {
            setConfigWritePending((previous) => {
                const next = { ...previous };
                delete next[key];
                return next;
            });
        }
    });

    const resolveConfigValue = (
        payload: unknown,
        category: string,
        itemName: string,
        fallback: string | number,
    ) => {
        const override = configOverrides[buildConfigKey(category, itemName)];
        if (override !== undefined) return override;
        const value = readItemValue(payload, category, itemName);
        return value === undefined ? fallback : (value as string | number);
    };

    return {
        configOverrides,
        configWritePending,
        updateConfigValue,
        resolveConfigValue,
    };
}
