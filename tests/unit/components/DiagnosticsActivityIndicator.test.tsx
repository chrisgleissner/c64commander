import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsActivityIndicator } from '@/components/DiagnosticsActivityIndicator';

const mockActivity = vi.hoisted(() => ({
    snapshot: {
        restCount: 0,
        ftpCount: 0,
        errorCount: 0,
        restInFlight: 0,
        ftpInFlight: 0,
    },
}));

vi.mock('@/hooks/useDiagnosticsActivity', () => ({
    useDiagnosticsActivity: () => mockActivity.snapshot,
}));

describe('DiagnosticsActivityIndicator', () => {
    it('renders REST/FTP indicators and hides error when empty', () => {
        mockActivity.snapshot = {
            restCount: 0,
            ftpCount: 0,
            errorCount: 0,
            restInFlight: 0,
            ftpInFlight: 0,
        };

        render(<DiagnosticsActivityIndicator onClick={() => undefined} />);

        expect(screen.getByTestId('diagnostics-activity-rest')).toBeInTheDocument();
        expect(screen.getByTestId('diagnostics-activity-ftp')).toBeInTheDocument();
        expect(screen.queryByTestId('diagnostics-activity-error')).not.toBeInTheDocument();
    });

    it('shows counts and animation for in-flight activity', () => {
        mockActivity.snapshot = {
            restCount: 2,
            ftpCount: 1,
            errorCount: 3,
            restInFlight: 1,
            ftpInFlight: 1,
        };

        render(<DiagnosticsActivityIndicator onClick={() => undefined} />);

        const rest = screen.getByTestId('diagnostics-activity-rest');
        const ftp = screen.getByTestId('diagnostics-activity-ftp');
        const error = screen.getByTestId('diagnostics-activity-error');

        expect(rest).toHaveClass('bg-diagnostics-rest');
        expect(ftp).toHaveClass('bg-diagnostics-ftp');
        expect(error).toHaveClass('bg-diagnostics-error');
        expect(rest).toHaveClass('animate-pulse-soft');
        expect(ftp).toHaveClass('animate-pulse-soft');
        expect(rest).toHaveTextContent('2');
        expect(ftp).toHaveTextContent('1');
        expect(error).toHaveTextContent('3');
    });

    it('invokes click handler', () => {
        const onClick = vi.fn();
        render(<DiagnosticsActivityIndicator onClick={onClick} />);

        fireEvent.click(screen.getByTestId('diagnostics-activity-indicator'));
        expect(onClick).toHaveBeenCalled();
    });
});
