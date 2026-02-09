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
            data-testid="test-heartbeat"
            style={{ position: 'fixed', bottom: 0, right: 0, fontSize: 1, color: 'transparent', pointerEvents: 'none', zIndex: -1 }}
        >
            {String(count)}
        </span>
    );
}
