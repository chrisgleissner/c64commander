/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  items: Array<{ title: string; id: string }>;
  scrollContainerRef: React.RefObject<HTMLElement>;
  onLetterSelect?: (letter: string) => void;
  onScrollToIndex?: (index: number) => void;
};

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function AlphabetScrollbar({ items, scrollContainerRef, onLetterSelect, onScrollToIndex }: Props) {
  const [visible, setVisible] = useState(false);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [isEligible, setIsEligible] = useState(false);
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
      if (index === undefined) return;

      if (onScrollToIndex) {
        onScrollToIndex(index);
      } else if (scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const targetItem = items[index];
        if (!targetItem) return;
        const safeId = typeof CSS !== 'undefined' && 'escape' in CSS
          ? CSS.escape(targetItem.id)
          : targetItem.id.replace(/"/g, '\\"');
        const targetRow = container.querySelector(`[data-row-id="${safeId}"]`) as HTMLElement | null;

        if (targetRow) {
          targetRow.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      } else {
        return;
      }

      setActiveLetter(letter);
      onLetterSelect?.(letter);
      scheduleHide();
    },
    [computeLetterIndices, scrollContainerRef, onLetterSelect, onScrollToIndex]
  );

  const handleTouch = useCallback(
    (clientY: number) => {
      if (!isEligible) return;
      if (!overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const relativeY = clientY - rect.top;
      const index = Math.floor((relativeY / rect.height) * LETTERS.length);
      const letter = LETTERS[Math.max(0, Math.min(LETTERS.length - 1, index))];
      if (letter) {
        scrollToLetter(letter);
      }
    },
    [isEligible, scrollToLetter]
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isEligible) return;
    clearHideTimeout();
    setVisible(true);
    handleTouch(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isEligible) return;
    handleTouch(e.touches[0].clientY);
  };

  const handleTouchEnd = () => {
    if (!isEligible) return;
    scheduleHide();
  };

  const handlePointerEnter = () => {
    if (!isEligible) return;
    clearHideTimeout();
    setVisible(true);
  };

  const handlePointerLeave = () => {
    if (!isEligible) return;
    scheduleHide();
  };

  const handleScroll = useCallback(() => {
    if (!isEligible) {
      setVisible(false);
      setActiveLetter(null);
      return;
    }
    clearHideTimeout();
    setVisible(true);
    scheduleHide();
  }, [isEligible]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, handleScroll]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let container: HTMLElement | null = null;

    const updateEligibility = () => {
      if (!container) return;
      const eligible = items.length >= LETTERS.length || container.scrollHeight > container.clientHeight * 1.1;
      setIsEligible(eligible);
      if (!eligible) {
        setVisible(false);
        setActiveLetter(null);
      }
    };

    const attachObservers = () => {
      if (cancelled) return;
      container = scrollContainerRef.current;
      if (!container) {
        requestAnimationFrame(attachObservers);
        return;
      }
      updateEligibility();
      resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateEligibility)
        : null;
      resizeObserver?.observe(container);
      window.addEventListener('resize', updateEligibility);
    };

    attachObservers();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateEligibility);
    };
  }, [items, scrollContainerRef]);

  useEffect(() => {
    return () => clearHideTimeout();
  }, []);

  return (
    <>
      {isEligible ? (
        <>
          {/* Touch area on the left edge */}
          <div
            ref={overlayRef}
            className="fixed left-0 top-0 bottom-0 w-12 z-50 touch-none"
            data-testid="alphabet-touch-area"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
          />

          {/* Visible overlay */}
          <div
            className={cn(
              'fixed left-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 py-2 px-1.5 rounded-lg bg-background/90 backdrop-blur-sm border border-border shadow-lg z-50 transition-opacity duration-200 pointer-events-none',
              visible ? 'opacity-100' : 'opacity-0'
            )}
            data-testid="alphabet-overlay"
          >
            {LETTERS.map((letter) => (
              <div
                key={letter}
                className={cn(
                  'text-xs font-semibold leading-none py-0.5 px-1 rounded transition-colors',
                  activeLetter === letter
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {letter}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Centered letter badge */}
      {visible && activeLetter && (
        <div
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background/95 backdrop-blur-sm border-2 border-primary rounded-xl px-6 py-4 shadow-2xl z-50 pointer-events-none"
          data-testid="alphabet-badge"
        >
          <div className="text-5xl font-bold text-primary">{activeLetter}</div>
        </div>
      )}
    </>
  );
}
