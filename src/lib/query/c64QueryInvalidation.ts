import type { QueryClient } from '@tanstack/react-query';
import type { ConnectionState } from '@/lib/connection/connectionManager';

type C64QueryPrefix =
    | 'c64-info'
    | 'c64-drives'
    | 'c64-categories'
    | 'c64-category'
    | 'c64-config-item'
    | 'c64-config-items'
    | 'c64-all-config';

const connectionSettingsPrefixes: ReadonlyArray<C64QueryPrefix> = [
    'c64-info',
    'c64-drives',
    'c64-categories',
    'c64-category',
    'c64-config-item',
    'c64-config-items',
    'c64-all-config',
];

const routePrefixMap: Array<{ routePrefix: string; prefixes: ReadonlyArray<C64QueryPrefix> }> = [
    {
        routePrefix: '/config',
        prefixes: ['c64-info', 'c64-categories', 'c64-category', 'c64-config-item', 'c64-config-items', 'c64-all-config'],
    },
    {
        routePrefix: '/disks',
        prefixes: ['c64-info', 'c64-drives', 'c64-config-items'],
    },
    {
        routePrefix: '/play',
        prefixes: ['c64-info', 'c64-config-item', 'c64-config-items'],
    },
    {
        routePrefix: '/settings',
        prefixes: ['c64-info', 'c64-categories'],
    },
    {
        routePrefix: '/docs',
        prefixes: ['c64-info'],
    },
    {
        routePrefix: '/',
        prefixes: ['c64-info', 'c64-drives', 'c64-config-items'],
    },
];

const uniquePrefixes = (prefixes: ReadonlyArray<C64QueryPrefix>) => Array.from(new Set(prefixes));

const invalidateByPrefix = (queryClient: QueryClient, prefixes: ReadonlyArray<C64QueryPrefix>) => {
    uniquePrefixes(prefixes).forEach((prefix) => {
        queryClient.invalidateQueries({ queryKey: [prefix] });
    });
};

export const getRouteInvalidationPrefixes = (pathname: string): ReadonlyArray<C64QueryPrefix> => {
    const normalizedPath = pathname.trim() || '/';
    const matchedEntry = routePrefixMap.find(({ routePrefix }) =>
        routePrefix === '/' ? normalizedPath === '/' : normalizedPath.startsWith(routePrefix),
    );
    return matchedEntry?.prefixes ?? ['c64-info'];
};

export const invalidateForRouteChange = (queryClient: QueryClient, pathname: string) => {
    invalidateByPrefix(queryClient, getRouteInvalidationPrefixes(pathname));
};

export const invalidateForVisibilityResume = (queryClient: QueryClient, pathname: string) => {
    invalidateByPrefix(queryClient, getRouteInvalidationPrefixes(pathname));
};

export const invalidateForConnectionSettingsChange = (queryClient: QueryClient) => {
    invalidateByPrefix(queryClient, connectionSettingsPrefixes);
};

export const invalidateForConnectionStateTransition = (
    queryClient: QueryClient,
    previousState: ConnectionState | null,
    nextState: ConnectionState,
) => {
    if (nextState === 'REAL_CONNECTED' && previousState !== 'REAL_CONNECTED') {
        invalidateByPrefix(queryClient, ['c64-info']);
        return;
    }
    if (previousState === 'REAL_CONNECTED' && nextState !== 'REAL_CONNECTED') {
        invalidateByPrefix(queryClient, ['c64-info']);
    }
};
