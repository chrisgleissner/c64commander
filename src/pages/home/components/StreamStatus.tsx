import { motion } from 'framer-motion';
import { SectionHeader } from '@/components/SectionHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSharedConfigActions } from '../hooks/ConfigActionsContext';
import { useStreamData } from '../hooks/useStreamData';
import { buildConfigKey } from '@/pages/home/utils/HomeConfigUtils';
import { buildStreamEndpointLabel } from '@/lib/config/homeStreams';

interface StreamStatusProps {
    isConnected: boolean;
}

export function StreamStatus({ isConnected }: StreamStatusProps) {
    const {
        configWritePending,
        updateConfigValue,
    } = useSharedConfigActions();

    const {
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
    } = useStreamData(isConnected, configWritePending, updateConfigValue);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38 }}
            className="space-y-2"
            data-testid="home-stream-status"
            data-section-label="Streams"
        >
            <SectionHeader title="Streams" />
            <div className="space-y-2">
                {streamControlEntries.map((entry) => {
                    const draft = streamDrafts[entry.key] ?? {
                        ip: entry.ip,
                        port: entry.port,
                        endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
                    };
                    const pending = Boolean(configWritePending[buildConfigKey('Data Streams', entry.itemName)]) || Boolean(streamActionPending[entry.key]);
                    return (
                        <div
                            key={entry.key}
                            className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
                            data-testid={`home-stream-row-${entry.key}`}
                        >
                            <div
                                className="flex items-center justify-between gap-2 text-xs"
                                aria-label={`${entry.label.toUpperCase()} stream ${draft.ip}:${draft.port}`}
                            >
                                <button
                                    type="button"
                                    className="min-w-0 flex-1 text-left flex items-center gap-2"
                                    onClick={() => handleStreamEditOpen(entry.key)}
                                    disabled={!isConnected || pending}
                                    data-testid={`home-stream-edit-toggle-${entry.key}`}
                                    aria-label={`Edit ${entry.label} stream target`}
                                >
                                    <span className="font-semibold text-foreground w-12">{entry.label.toUpperCase()}</span>
                                    <span className="font-semibold text-foreground truncate" data-testid={`home-stream-endpoint-display-${entry.key}`}>
                                        {buildStreamEndpointLabel(draft.ip, draft.port)}
                                    </span>
                                </button>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleStreamStart(entry.key)}
                                        disabled={!isConnected || pending}
                                        data-testid={`home-stream-start-${entry.key}`}
                                        className="h-6 px-2 text-xs"
                                    >
                                        Start
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleStreamStop(entry.key)}
                                        disabled={!isConnected || pending}
                                        data-testid={`home-stream-stop-${entry.key}`}
                                        className="h-6 px-2 text-xs"
                                    >
                                        Stop
                                    </Button>
                                </div>
                            </div>
                            {activeStreamEditorKey === entry.key && (
                                <div className="mt-2 rounded-md border border-border/60 bg-background p-2.5">
                                    <div className="grid grid-cols-1 gap-2 text-[11px] md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                                        <div className="space-y-1">
                                            <label htmlFor={`home-stream-endpoint-${entry.key}`} className="text-muted-foreground">IP:PORT</label>
                                            <Input
                                                id={`home-stream-endpoint-${entry.key}`}
                                                value={draft.endpoint}
                                                onChange={(event) => handleStreamFieldChange(entry.key, event.target.value)}
                                                disabled={!isConnected || pending}
                                                data-testid={`home-stream-endpoint-${entry.key}`}
                                                aria-label={`${entry.label} stream endpoint`}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleStreamEditCancel(entry.key)}
                                            disabled={!isConnected || pending}
                                            data-testid={`home-stream-cancel-${entry.key}`}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void handleStreamCommit(entry.key)}
                                            disabled={!isConnected || pending}
                                            data-testid={`home-stream-confirm-${entry.key}`}
                                        >
                                            OK
                                        </Button>
                                    </div>
                                    {streamEditorError && (
                                        <p className="mt-2 text-[11px] text-destructive" data-testid={`home-stream-error-${entry.key}`}>
                                            {streamEditorError}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </motion.div>
    );
}
