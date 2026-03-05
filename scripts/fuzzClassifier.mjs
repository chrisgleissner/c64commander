/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Deterministic fuzz issue classification layer.
 *
 * Classification happens only during report generation.
 * Application log severity is never modified by this module.
 * Issue grouping signatures are unchanged.
 */

export const DOMAINS = /** @type {const} */ ([
    'NETWORK',
    'UI',
    'DEVICE_ACTION',
    'FILESYSTEM',
    'FUZZ_INFRASTRUCTURE',
    'BACKEND',
    'UNKNOWN',
]);

export const CLASSIFICATIONS = /** @type {const} */ (['REAL', 'UNCERTAIN', 'EXPECTED']);

export const CONFIDENCE_LEVELS = /** @type {const} */ (['HIGH', 'MEDIUM', 'LOW']);

/**
 * Tag that identifies a synthetic issue injected by the selftest harness (FUZZ_SELFTEST=1).
 * Messages containing this tag are always classified as REAL to verify end-to-end detection.
 * Do NOT add this tag to FUZZ_INFRASTRUCTURE_PATTERNS — it must surface as REAL.
 */
export const SELFTEST_TAG = '[fuzz-selftest]';

// ---------------------------------------------------------------------------
// Internal pattern sets
// ---------------------------------------------------------------------------

/** Messages that always represent fuzz infrastructure noise (never real bugs). */
const FUZZ_INFRASTRUCTURE_PATTERNS = [
    'DiagnosticsBridge unavailable',
    'Category config fetch failed',
    'API device host changed',
    'C64 API retry scheduled',
    'Songlengths unavailable',
    'HVSC filesystem:',
    'HVSC paged folder listing failed',
    'HVSC songlengths directory bootstrap failed',
    'HVSC progress interrupted',
    'Failed to capture initial config snapshot',
    'Failed to fetch category',
    'localStorage init failed',
    'fuzz mode blocked',
    'Fuzz mode blocked',
    '[fuzz]',
    'Element is not attached',
];

/** Messages that indicate device-operation failures (expected when mock server is absent). */
const DEVICE_ACTION_PREFIXES = [
    /^HOME_[A-Z_]+: /,
    /^AUDIO_ROUTING: /,
    /^RESET_DRIVES/,
    /^DRIVE_POWER/,
    /^DRIVE_CONFIG_UPDATE/,
    /^SOFT_IEC_CONFIG_UPDATE/,
    /^RAM_DUMP_FOLDER_SELECT/,
    /^BROWSE: /,
    /^CONFIG_UPDATE/,
    // audio/video streaming operations: STREAM_VALIDATE, STREAM_START, STREAM_STOP etc.
    /^STREAM_/,
];

const DEVICE_ACTION_SUBSTRINGS = [
    'RAM operation retry',
    'Failed to resume machine after clear-memory error',
    'Machine pause/resume failed',
    // config write queue cascade: always a device-config operation failure in fuzz (mock server absent)
    'Config write queue',
];

/** Network-failure message substrings. */
const NETWORK_SUBSTRINGS = [
    'C64 API request failed',
    'C64 API upload failed',
    'FTP listing failed',
    'Source browse failed',
    'service unavailable',
    'Service unavailable',
    'HTTP 503',
    'failed to load resource',
    'Failed to load resource',
    'network offline',
    'Network offline',
    'connection refused',
    'Connection refused',
    'latency',
    'Request timeout',
    'request timeout',
    'ECONNREFUSED',
    'ETIMEDOUT',
];

/** Filesystem-related message substrings (non-HVSC). */
const FILESYSTEM_SUBSTRINGS = [
    'RAM dump',
    'disk image',
    'filesystem',
    'file system',
];

/** Backend / server-side logic substrings. */
const BACKEND_SUBSTRINGS = [
    'JSON parse',
    'parse error',
    'Unexpected token',
    'invalid JSON',
    'server error',
    'Internal server error',
    'status code',
    'HTTP 4',
    'HTTP 5',
    '404',
    '500',
    '502',
    '503',
];

/** Exception types or message fragments that strongly indicate UI defects. */
const UI_EXCEPTION_PATTERNS = [
    'TypeError',
    'ReferenceError',
    'Cannot read propert',
    'Cannot set propert',
    'is not a function',
    'is not defined',
    'undefined is not',
    'null is not',
    'Element is not attached',
    'Target closed',
    'Navigation failed',
    'Execution context was destroyed',
];

/** Chaos action names emitted to interaction logs by the fuzz runner. */
const CHAOS_ACTION_NAMES = [
    'network-offline',
    'connection-flap',
    'latency-spike',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const includes = (text, patterns) =>
    patterns.some((pattern) => text.includes(pattern));

const matchesAny = (text, regexes) =>
    regexes.some((re) => re.test(text));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if any of the provided interaction log lines indicate that a
 * chaos event (network disruption, connection flap, latency spike) took place
 * near this issue. These come from `examples[].lastInteractions` in the report.
 *
 * @param {string[]} lastInteractions - Interaction log lines from an issue example.
 * @returns {boolean}
 */
export const hasChaosEvidence = (lastInteractions) => {
    if (!Array.isArray(lastInteractions)) return false;
    return lastInteractions.some((line) =>
        CHAOS_ACTION_NAMES.some((name) => line.includes(`a=${name}`)),
    );
};

/**
 * Classify the domain of an issue based on its signature and interaction context.
 * Domain classification is deterministic and message-pattern based.
 *
 * @param {{ exception?: string; message?: string; topFrames?: string[] }} signature
 * @param {string[]} lastInteractions
 * @returns {string} One of the DOMAINS values.
 */
export const classifyDomain = (signature, lastInteractions) => {
    const msg = (signature?.message || '').toLowerCase();
    const exc = (signature?.exception || '').toLowerCase();
    const frames = (signature?.topFrames || []).join(' ').toLowerCase();
    const rawMsg = signature?.message || '';
    const rawExc = signature?.exception || '';

    // FUZZ_INFRASTRUCTURE: always-expected structural noise
    if (includes(rawMsg, FUZZ_INFRASTRUCTURE_PATTERNS)) return 'FUZZ_INFRASTRUCTURE';
    if (includes(rawExc, FUZZ_INFRASTRUCTURE_PATTERNS)) return 'FUZZ_INFRASTRUCTURE';
    if (frames.includes('playwright/fuzz/chaosrunner.fuzz.ts')) return 'FUZZ_INFRASTRUCTURE';

    // DEVICE_ACTION: device operation failures
    if (matchesAny(rawMsg, DEVICE_ACTION_PREFIXES)) return 'DEVICE_ACTION';
    if (includes(rawMsg, DEVICE_ACTION_SUBSTRINGS)) return 'DEVICE_ACTION';

    // NETWORK: API/network failures
    if (includes(rawMsg, NETWORK_SUBSTRINGS)) return 'NETWORK';
    if (msg.includes('network') && (msg.includes('fail') || msg.includes('error') || msg.includes('offline'))) return 'NETWORK';
    if (exc.includes('app.log') && hasChaosEvidence(lastInteractions)) return 'NETWORK';

    // FILESYSTEM: file/disk operations
    if (includes(rawMsg, FILESYSTEM_SUBSTRINGS)) return 'FILESYSTEM';

    // BACKEND: server-side processing errors
    if (includes(rawMsg, BACKEND_SUBSTRINGS)) return 'BACKEND';

    // UI: TypeError/DOM interaction failures in non-expected context
    // Note: rawExc is always a source label (app.log.error, console.error etc.),
    // not a native exception type. Only rawMsg and topFrames are checked.
    if (includes(rawMsg, UI_EXCEPTION_PATTERNS)) return 'UI';
    if (includes(frames, ['TypeError', 'ReferenceError', 'components/', 'pages/'])) return 'UI';

    return 'UNKNOWN';
};

/**
 * Classify an issue group into REAL, UNCERTAIN, or EXPECTED, with a confidence
 * level and optional human-readable explanation.
 *
 * Classification is deterministic given the same input.
 * Application log severity is never modified here.
 *
 * @param {{
 *   issue_group_id?: string;
 *   signature?: { exception?: string; message?: string; topFrames?: string[] };
 *   severityCounts?: Record<string, number>;
 *   examples?: Array<{ lastInteractions?: string[]; shardIndex?: number }>;
 * }} group - An IssueGroup from fuzz-issue-report.json.
 * @returns {{
 *   classification: 'REAL' | 'UNCERTAIN' | 'EXPECTED';
 *   domain: string;
 *   confidence: 'HIGH' | 'MEDIUM' | 'LOW';
 *   explanation: string | null;
 * }}
 */
export const classifyIssue = (group) => {
    const signature = group?.signature || {};
    const severityCounts = group?.severityCounts || {};
    const examples = group?.examples || [];
    const lastInteractions = examples[0]?.lastInteractions || [];

    const hasCrash = (severityCounts.crash || 0) > 0;
    const hasFreeze = (severityCounts.freeze || 0) > 0;
    const hasTerminalSeverity = hasCrash || hasFreeze;

    const domain = classifyDomain(signature, lastInteractions);
    const chaosPresent = hasChaosEvidence(lastInteractions);
    const rawMsg = signature?.message || '';
    const rawExc = signature?.exception || '';

    // --- SELFTEST: always REAL regardless of other rules ---
    // Messages tagged with SELFTEST_TAG are injected by the selftest harness to verify
    // that the detection pipeline surfaces REAL issues and does not suppress them.
    if (rawMsg.includes(SELFTEST_TAG)) {
        return {
            classification: 'REAL',
            domain: 'FUZZ_INFRASTRUCTURE',
            confidence: 'HIGH',
            explanation:
                'Synthetic selftest issue injected to verify the detection pipeline. ' +
                'This entry confirms that REAL issues are correctly surfaced and not suppressed. ' +
                'Remove FUZZ_SELFTEST=1 from the environment to restore normal behaviour.',
        };
    }

    // --- EXPECTED: terminal severity never qualifies as EXPECTED ---

    if (!hasTerminalSeverity) {
        // FUZZ_INFRASTRUCTURE: always structural noise
        if (domain === 'FUZZ_INFRASTRUCTURE') {
            return {
                classification: 'EXPECTED',
                domain,
                confidence: 'HIGH',
                explanation:
                    'This message is emitted by the fuzz infrastructure or reflects a known ' +
                    'structural absence (no native bridge, no real C64U hardware). ' +
                    'It is always expected in the fuzz environment.',
            };
        }

        // DEVICE_ACTION: expected because mock server never provides hardware endpoints;
        // confidence is HIGH when chaos event confirms network disruption was active
        if (domain === 'DEVICE_ACTION') {
            return {
                classification: 'EXPECTED',
                domain,
                confidence: chaosPresent ? 'HIGH' : 'MEDIUM',
                explanation:
                    'Device operation failures are expected in the fuzz environment. ' +
                    'The mock server does not implement hardware-level endpoints ' +
                    '(memory, RAM dump, FTP, drive power, audio). ' +
                    (chaosPresent
                        ? 'Chaos event detected in interaction log confirms network disruption was active.'
                        : 'No explicit chaos event confirmed, but the mock server always returns 404 for hardware endpoints.'),
            };
        }

        // NETWORK: expected when chaos evidence present; uncertain otherwise
        if (domain === 'NETWORK') {
            if (chaosPresent) {
                return {
                    classification: 'EXPECTED',
                    domain,
                    confidence: 'HIGH',
                    explanation:
                        'Network disruptions are intentionally introduced by the fuzz runner ' +
                        '(network-offline / connection-flap / latency-spike). ' +
                        'This failure is a direct consequence of chaos-induced network instability.',
                };
            }
            // No explicit chaos event but mock server always causes network-level failures
            if (includes(rawMsg, [
                'C64 API request failed',
                'C64 API upload failed',
                'FTP listing failed',
                'Source browse failed',
            ])) {
                return {
                    classification: 'EXPECTED',
                    domain,
                    confidence: 'MEDIUM',
                    explanation:
                        'C64 API and FTP failures are expected because the mock server does not ' +
                        'implement every endpoint. No explicit chaos event confirmed in interaction log.',
                };
            }
        }

        // FILESYSTEM: HVSC/disk ops that always fail under fuzz conditions
        if (domain === 'FILESYSTEM' && includes(rawMsg, [
            'HVSC paged folder',
            'HVSC songlengths',
            'HVSC progress',
            'RAM dump',
        ])) {
            return {
                classification: 'EXPECTED',
                domain,
                confidence: 'MEDIUM',
                explanation:
                    'Filesystem operations over HVSC and RAM dump paths always fail in the fuzz ' +
                    'environment because HVSC is not loaded and the device is a mock.',
            };
        }
    }

    // --- REAL: crash or freeze always indicates a genuine defect ---

    if (hasTerminalSeverity) {
        const termType = hasCrash ? 'crash' : 'freeze';
        return {
            classification: 'REAL',
            domain,
            confidence: 'HIGH',
            explanation:
                `A ${termType} indicates an unrecoverable failure that is not expected under ` +
                'normal fuzz operating conditions. Investigate the top stack frames for root cause.',
        };
    }

    // --- REAL: TypeError / ReferenceError in non-network context ---

    const isJsError =
        rawExc.includes('TypeError') || rawExc.includes('ReferenceError') ||
        rawMsg.includes('TypeError') || rawMsg.includes('ReferenceError') ||
        rawMsg.includes('Cannot read propert') || rawMsg.includes('is not a function') ||
        rawMsg.includes('undefined is not') || rawMsg.includes('null is not');

    if (isJsError && domain === 'UI') {
        return {
            classification: 'REAL',
            domain,
            confidence: 'HIGH',
            explanation:
                'A JavaScript TypeError or ReferenceError in the UI layer indicates a code defect. ' +
                'Check the top stack frames for the null/undefined access path.',
        };
    }

    if (isJsError) {
        return {
            classification: 'REAL',
            domain,
            confidence: 'MEDIUM',
            explanation:
                'A JavaScript TypeError or ReferenceError was emitted. ' +
                'This may be a genuine code defect. Inspect the top stack frames.',
        };
    }

    // --- UNCERTAIN: backend errors without direct chaos correlation ---

    if (domain === 'BACKEND') {
        return {
            classification: 'UNCERTAIN',
            domain,
            confidence: 'MEDIUM',
            explanation:
                'A backend processing error was detected. ' +
                'This could be caused by the mock server returning unexpected responses, ' +
                'or by a genuine parsing/logic defect. Inspect the response payload and stack frames.',
        };
    }

    // --- UNCERTAIN: NETWORK without chaos evidence and not a known mock failure ---

    if (domain === 'NETWORK') {
        return {
            classification: 'UNCERTAIN',
            domain,
            confidence: 'MEDIUM',
            explanation:
                'A network-related error was detected without a confirmed chaos event. ' +
                'May be a fuzz artifact or a genuine defect. Inspect the request context.',
        };
    }

    // --- UNCERTAIN: everything else ---

    return {
        classification: 'UNCERTAIN',
        domain,
        confidence: domain === 'UNKNOWN' ? 'LOW' : 'MEDIUM',
        explanation: null,
    };
};

/**
 * Classify all issue groups and return a map from issue_group_id to classification result.
 *
 * @param {Array<{ issue_group_id: string }>} issueGroups
 * @returns {Map<string, ReturnType<typeof classifyIssue>>}
 */
export const classifyAllIssues = (issueGroups) => {
    const result = new Map();
    for (const group of issueGroups) {
        result.set(group.issue_group_id, classifyIssue(group));
    }
    return result;
};
