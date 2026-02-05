import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiagnosticsListItem } from '@/components/diagnostics/DiagnosticsListItem';

describe('DiagnosticsListItem', () => {
    it('renders a shared summary layout with timestamp', () => {
        render(
            <DiagnosticsListItem
                mode="trace"
                title="Trace entry"
                timestamp="12:34:56.789"
            >
                <div>details</div>
            </DiagnosticsListItem>,
        );

        const summary = screen.getByText('Trace entry').closest('summary');
        expect(summary).toBeTruthy();
        expect(summary?.querySelector('[class*="grid-cols-[minmax(0,1fr)_auto]"]')).toBeTruthy();
        expect(screen.getByText('Trace entry')).toHaveClass('break-words');
        expect(screen.getByText('12:34:56.789')).toBeInTheDocument();
        expect(screen.queryByText(/ms/)).not.toBeInTheDocument();
    });

    it('renders action origin dot and secondary line', () => {
        render(
            <DiagnosticsListItem
                mode="action"
                title="Action name"
                timestamp="01:02:03.004"
                origin="user"
                secondaryLeft={<span>REST×1</span>}
                secondaryRight="25 ms"
            />,
        );

        expect(screen.getByLabelText('user')).toHaveClass('bg-diagnostics-user');
        expect(screen.getByText('REST×1')).toBeInTheDocument();
        expect(screen.getByText('25 ms')).toBeInTheDocument();
    });
});
