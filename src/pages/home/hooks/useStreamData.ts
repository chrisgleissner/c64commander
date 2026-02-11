import { useState, useMemo, useEffect } from 'react';
import { getC64API } from '@/lib/c64api';
import { useC64ConfigItems } from '@/hooks/useC64Connection';
import { useActionTrace } from '@/hooks/useActionTrace';
import { toast } from '@/hooks/use-toast';
import { reportUserError } from '@/lib/uiErrors';
import {
    buildStreamConfigValue,
    buildStreamEndpointLabel,
    buildStreamControlEntries,
    parseStreamEndpoint,
    validateStreamHost,
    validateStreamPort,
    type StreamKey,
    STREAM_ITEMS
} from '@/lib/config/homeStreams';
import { buildConfigKey } from '@/pages/home/utils/HomeConfigUtils';

export function useStreamData(
    isConnected: boolean,
    configWritePending: Record<string, boolean>,
    updateConfigValue: (
        category: string,
        item: string,
        value: string | number,
        actionId: string,
        toastMessage: string,
        options?: { suppressToast?: boolean, refreshDrives?: boolean }
    ) => Promise<void>
) {
    const api = getC64API();
    const trace = useActionTrace('useStreamData');

    const { data: streamCategory } = useC64ConfigItems(
        'Data Streams',
        STREAM_ITEMS,
        isConnected, // Use isConnected directly as status.isConnected || status.isConnecting
    );

    const streamControlEntries = useMemo(
        () => buildStreamControlEntries(streamCategory as Record<string, unknown> | undefined),
        [streamCategory],
    );

    const [streamDrafts, setStreamDrafts] = useState<Record<string, { ip: string; port: string; endpoint: string }>>({});
    const [activeStreamEditorKey, setActiveStreamEditorKey] = useState<StreamKey | null>(null);
    const [streamEditorError, setStreamEditorError] = useState<string | null>(null);
    const [streamActionPending, setStreamActionPending] = useState<Record<string, boolean>>({});

    useEffect(() => {
        setStreamDrafts((previous) => {
            const next = { ...previous };
            streamControlEntries.forEach((entry) => {
                const configKey = buildConfigKey('Data Streams', entry.itemName);
                if (configWritePending[configKey]) return;
                if (activeStreamEditorKey === entry.key) return;

                next[entry.key] = {
                    ip: entry.ip,
                    port: entry.port,
                    endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
                };
            });
            return next;
        });
    }, [activeStreamEditorKey, streamControlEntries, configWritePending]);

    const handleStreamStart = trace(async function handleStreamStart(key: StreamKey) {
        const entry = streamControlEntries.find((value) => value.key === key);
        if (!entry) return;
        const draft = streamDrafts[key] ?? {
            ip: entry.ip,
            port: entry.port,
            endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
        };
        const hostError = validateStreamHost(draft.ip);
        const portError = validateStreamPort(draft.port);
        if (hostError || portError) {
            reportUserError({
                operation: 'STREAM_VALIDATE',
                title: 'Invalid stream target',
                description: hostError ?? portError ?? 'Invalid stream target',
                context: { stream: key, ip: draft.ip, port: draft.port },
            });
            setStreamEditorError(hostError ?? portError ?? 'Invalid stream target');
            return;
        }
        setStreamEditorError(null);
        const ipPort = `${draft.ip.trim()}:${draft.port.trim()}`;
        setStreamActionPending((prev) => ({ ...prev, [key]: true }));
        try {
            await api.startStream(entry.restName, ipPort);
            toast({ title: `${entry.label} start command sent` });
        } catch (error) {
            reportUserError({
                operation: 'STREAM_START',
                title: 'Stream start failed',
                description: (error as Error).message,
                error,
                context: { stream: key, ip: ipPort },
            });
        } finally {
            setStreamActionPending((prev) => ({ ...prev, [key]: false }));
        }
    });

    const handleStreamStop = trace(async function handleStreamStop(key: StreamKey) {
        const entry = streamControlEntries.find((value) => value.key === key);
        if (!entry) return;
        setStreamEditorError(null);
        setStreamActionPending((prev) => ({ ...prev, [key]: true }));
        try {
            await api.stopStream(entry.restName);
            toast({ title: `${entry.label} stop command sent` });
        } catch (error) {
            reportUserError({
                operation: 'STREAM_STOP',
                title: 'Stream stop failed',
                description: (error as Error).message,
                error,
                context: { stream: key },
            });
        } finally {
            setStreamActionPending((prev) => ({ ...prev, [key]: false }));
        }
    });

    const handleStreamFieldChange = (key: StreamKey, value: string) => {
        const parsed = parseStreamEndpoint(value);
        setStreamEditorError(null);
        setStreamDrafts((previous) => {
            const fallback = { ip: '', port: '', endpoint: '' };
            const current = previous[key] ?? fallback;
            return {
                ...previous,
                [key]: {
                    ...current,
                    endpoint: value,
                    ip: parsed.ip,
                    port: parsed.port,
                },
            };
        });
    };

    const handleStreamEditOpen = (key: StreamKey) => {
        const entry = streamControlEntries.find((value) => value.key === key);
        if (!entry) return;
        setStreamDrafts((previous) => ({
            ...previous,
            [key]: {
                ip: entry.ip,
                port: entry.port,
                endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
            },
        }));
        setStreamEditorError(null);
        setActiveStreamEditorKey(key);
    };

    const handleStreamEditCancel = (key: StreamKey) => {
        const entry = streamControlEntries.find((value) => value.key === key);
        if (entry) {
            setStreamDrafts((previous) => ({
                ...previous,
                [key]: {
                    ip: entry.ip,
                    port: entry.port,
                    endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
                },
            }));
        }
        setStreamEditorError(null);
        setActiveStreamEditorKey((previous) => (previous === key ? null : previous));
    };

    const handleStreamCommit = trace(async function handleStreamCommit(key: StreamKey) {
        const entry = streamControlEntries.find((value) => value.key === key);
        if (!entry) return false;
        const current = streamDrafts[key] ?? {
            ip: entry.ip,
            port: entry.port,
            endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
        };
        const parsed = parseStreamEndpoint(current.endpoint);
        if (parsed.error) {
            reportUserError({
                operation: 'STREAM_VALIDATE',
                title: 'Invalid stream endpoint',
                description: parsed.error,
                context: { stream: key, endpoint: current.endpoint },
            });
            setStreamEditorError(parsed.error);
            return false;
        }
        const nextIp = parsed.ip;
        const nextPort = parsed.port;
        setStreamDrafts((previous) => ({
            ...previous,
            [key]: {
                ...current,
                ip: nextIp,
                port: nextPort,
                endpoint: buildStreamEndpointLabel(nextIp, nextPort),
            },
        }));
        const hostError = validateStreamHost(nextIp);
        if (hostError) {
            reportUserError({
                operation: 'STREAM_VALIDATE',
                title: 'Invalid stream host',
                description: hostError,
                context: { stream: key, ip: nextIp },
            });
            setStreamEditorError(hostError);
            return false;
        }
        const portError = validateStreamPort(nextPort);
        if (portError) {
            reportUserError({
                operation: 'STREAM_VALIDATE',
                title: 'Invalid stream port',
                description: portError,
                context: { stream: key, port: nextPort },
            });
            setStreamEditorError(portError);
            return false;
        }
        setStreamEditorError(null);
        await updateConfigValue(
            'Data Streams',
            entry.itemName,
            buildStreamConfigValue(true, nextIp, nextPort),
            'HOME_STREAM_UPDATE',
            `${entry.label} stream target updated`,
        );
        setActiveStreamEditorKey(null);
        return true;
    });

    return {
        streamControlEntries,
        streamDrafts,
        activeStreamEditorKey,
        streamEditorError,
        streamActionPending,
        handleStreamStart,
        handleStreamStop,
        handleStreamFieldChange,
        handleStreamEditOpen,
        handleStreamEditCancel,
        handleStreamCommit,
    };
}
