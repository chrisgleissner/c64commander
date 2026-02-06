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
    it('hides all indicators when all counts are zero', () => {
        mockActivity.snapshot = {
            restCount: 0,
            ftpCount: 0,
            errorCount: 0,
            restInFlight: 0,
            ftpInFlight: 0,
        };

        render(<DiagnosticsActivityIndicator onClick={() => undefined} />);

        expect(screen.queryByTestId('diagnostics-activity-rest')).not.toBeInTheDocument();
        expect(screen.queryByTestId('diagnostics-activity-ftp')).not.toBeInTheDocument();
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

    it('shows only REST indicator when only REST count is non-zero', () => {
        mockActivity.snapshot = {
            restCount: 5,
            ftpCount: 0,
            errorCount: 0,
            restInFlight: 0,
            ftpInFlight: 0,
        };

        render(<DiagnosticsActivityIndicator onClick={() => undefined} />);

        expect(screen.getByTestId('diagnostics-activity-rest')).toBeInTheDocument();
        expect(screen.queryByTestId('diagnostics-activity-ftp')).not.toBeInTheDocument();
        expect(screen.queryByTestId('diagnostics-activity-error')).not.toBeInTheDocument();
    });

    it('shows only FTP indicator when only FTP count is non-zero', () => {
        mockActivity.snapshot = {
            restCount: 0,
            ftpCount: 3,
            errorCount: 0,
            restInFlight: 0,
            ftpInFlight: 0,
        };

        render(<DiagnosticsActivityIndicator onClick={() => undefined} />);

        expect(screen.queryByTestId('diagnostics-activity-rest')).not.toBeInTheDocument();
        expect(screen.getByTestId('diagnostics-activity-ftp')).toBeInTheDocument();
        expect(screen.queryByTestId('diagnostics-activity-error')).not.toBeInTheDocument();
    });

    it('renders indicator dots at increased size (h-5 w-5)', () => {
        mockActivity.snapshot = {
            restCount: 1,
            ftpCount: 1,
            errorCount: 1,
            restInFlight: 0,
            ftpInFlight: 0,
        };

        render(<DiagnosticsActivityIndicator onClick={() => undefined} />);

        const rest = screen.getByTestId('diagnostics-activity-rest');
        expect(rest).toHaveClass('h-5');
        expect(rest).toHaveClass('w-5');
    });

    it('invokes click handler', () => {
        const onClick = vi.fn();
        render(<DiagnosticsActivityIndicator onClick={onClick} />);

        fireEvent.click(screen.getByTestId('diagnostics-activity-indicator'));
        expect(onClick).toHaveBeenCalled();
    });
});
