export type LogEventInput = {
    kind: string;
    op: string;
    status?: number | string;
    latencyMs?: number;
    details?: Record<string, unknown>;
    [key: string]: unknown;
};
