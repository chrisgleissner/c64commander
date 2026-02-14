/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * Test-only component that increments a counter every second.
 * Rendered only when `VITE_ENABLE_TEST_PROBES=1`.
 * Maestro tests use the displayed counter to verify JS execution
 * continues while the screen is locked.
 */
export function TestHeartbeat() {
    const [count, setCount] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        timerRef.current = setInterval(() => {
            setCount((c) => c + 1);
        }, 1000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    return (
        <span
            id="test-heartbeat"
            data-testid="test-heartbeat"
            style={{ position: 'fixed', bottom: 0, right: 0, fontSize: 8, lineHeight: 1, opacity: 0.01, pointerEvents: 'none', zIndex: 2147483647 }}
        >
            {String(count)}
        </span>
    );
}
