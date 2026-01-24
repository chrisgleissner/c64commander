import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  items: Array<{ title: string; id: string }>;
  scrollContainerRef: React.RefObject<HTMLElement>;
  onLetterSelect?: (letter: string) => void;
};

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function AlphabetScrollbar({ items, scrollContainerRef, onLetterSelect }: Props) {
  const [visible, setVisible] = useState(false);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const clearHideTimeout = () => {
    if (hideTimeoutRef.current !== null) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const scheduleHide = () => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      setActiveLetter(null);
    }, 1500);
  };

  const computeLetterIndices = useCallback(() => {
    const indices = new Map<string, number>();
    items.forEach((item, index) => {
      const first = item.title.trim()[0]?.toUpperCase() || '#';
      const letter = /[A-Z]/.test(first) ? first : '#';
      if (!indices.has(letter)) {
        indices.set(letter, index);
      }
    });
    return indices;
  }, [items]);

  const scrollToLetter = useCallback(
    (letter: string) => {
      const indices = computeLetterIndices();
      const index = indices.get(letter);
      if (index === undefined || !scrollContainerRef.current) return;

      const container = scrollContainerRef.current;
      const rows = container.querySelectorAll('[data-row-id]');
      const targetRow = rows[index] as HTMLElement | undefined;
      
      if (targetRow) {
        targetRow.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }

      setActiveLetter(letter);
      onLetterSelect?.(letter);
      scheduleHide();
    },
    [computeLetterIndices, scrollContainerRef, onLetterSelect]
  );

  const handleTouch = useCallback(
    (clientY: number) => {
      if (!overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const relativeY = clientY - rect.top;
      const index = Math.floor((relativeY / rect.height) * LETTERS.length);
      const letter = LETTERS[Math.max(0, Math.min(LETTERS.length - 1, index))];
      if (letter) {
        scrollToLetter(letter);
      }
    },
    [scrollToLetter]
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    clearHideTimeout();
    setVisible(true);
    handleTouch(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    handleTouch(e.touches[0].clientY);
  };

  const handleTouchEnd = () => {
    scheduleHide();
  };

  const handlePointerEnter = () => {
    clearHideTimeout();
    setVisible(true);
  };

  const handlePointerLeave = () => {
    scheduleHide();
  };

  const handleScroll = useCallback(() => {
    clearHideTimeout();
    setVisible(true);
    scheduleHide();
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, handleScroll]);

  useEffect(() => {
    return () => clearHideTimeout();
  }, []);

  return (
    <>
      {/* Touch area on the right edge */}
      <div
        ref={overlayRef}
        className="fixed right-0 top-0 bottom-0 w-12 z-50 touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      />
      
      {/* Visible overlay */}
      <div
        className={cn(
          'fixed right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 py-2 px-1.5 rounded-lg bg-background/90 backdrop-blur-sm border border-border shadow-lg z-50 transition-opacity duration-200 pointer-events-none',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      >
        {LETTERS.map((letter) => (
          <div
            key={letter}
            className={cn(
              'text-xs font-mono font-semibold leading-none py-0.5 px-1 rounded transition-colors',
              activeLetter === letter
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground'
            )}
          >
            {letter}
          </div>
        ))}
      </div>

      {/* Centered letter badge */}
      {visible && activeLetter && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background/95 backdrop-blur-sm border-2 border-primary rounded-xl px-6 py-4 shadow-2xl z-50 pointer-events-none">
          <div className="text-5xl font-bold text-primary">{activeLetter}</div>
        </div>
      )}
    </>
  );
}
