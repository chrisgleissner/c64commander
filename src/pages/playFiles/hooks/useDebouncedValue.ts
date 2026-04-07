import { useEffect, useState } from "react";

export const useDebouncedValue = <T>(value: T, delayMs: number) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        if (Object.is(value, debouncedValue)) {
            return;
        }
        const timer = window.setTimeout(() => {
            setDebouncedValue(value);
        }, delayMs);
        return () => {
            window.clearTimeout(timer);
        };
    }, [debouncedValue, delayMs, value]);

    return debouncedValue;
};
