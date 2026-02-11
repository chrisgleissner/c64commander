/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from 'react';

export type PathDisplayMode = 'filename-fallback' | 'start-and-filename';
export type TextMeasureFn = (value: string) => number;

const ELLIPSIS = '...';

const normalizePath = (value: string) => value.replace(/\\/g, '/');

const parsePath = (value: string) => {
  const normalized = normalizePath(value).trim();
  if (!normalized) return { root: '', directories: [] as string[], fileName: '' };
  const hasLeadingSlash = normalized.startsWith('/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.pop() ?? '';
  const root = hasLeadingSlash ? '/' : '';
  return { root, directories: parts, fileName };
};

export const getFileNameFromPath = (value: string) => {
  const { fileName } = parsePath(value);
  return fileName || value;
};

const trimFromStartToFit = (value: string, maxWidth: number, measure: TextMeasureFn) => {
  if (!value) return value;
  if (measure(value) <= maxWidth) return value;
  if (measure(ELLIPSIS) > maxWidth) return '';
  for (let keep = value.length; keep >= 1; keep -= 1) {
    const candidate = `${ELLIPSIS}${value.slice(value.length - keep)}`;
    if (measure(candidate) <= maxWidth) {
      return candidate;
    }
  }
  return '';
};

const fitFilenameFallback = (path: string, maxWidth: number, measure: TextMeasureFn) => {
  if (measure(path) <= maxWidth) return path;
  const fileName = getFileNameFromPath(path);
  if (measure(fileName) <= maxWidth) return fileName;
  return trimFromStartToFit(fileName, maxWidth, measure);
};

const buildStartAndFilenameCandidate = (
  root: string,
  directories: string[],
  prefixSegments: number,
  fileName: string,
) => {
  const prefix = directories.slice(0, prefixSegments).join('/');
  if (prefix) {
    return `${root}${prefix}/${ELLIPSIS}/${fileName}`;
  }
  return `${root}${ELLIPSIS}/${fileName}`;
};

const fitStartAndFilename = (path: string, maxWidth: number, measure: TextMeasureFn) => {
  if (measure(path) <= maxWidth) return path;
  const { root, directories, fileName } = parsePath(path);
  if (!fileName) return trimFromStartToFit(path, maxWidth, measure);

  for (let count = directories.length; count >= 0; count -= 1) {
    const candidate = buildStartAndFilenameCandidate(root, directories, count, fileName);
    if (measure(candidate) <= maxWidth) {
      return candidate;
    }
  }

  return trimFromStartToFit(fileName, maxWidth, measure);
};

export const fitPathToWidth = (
  path: string,
  maxWidth: number,
  measure: TextMeasureFn,
  mode: PathDisplayMode,
) => {
  if (!path || maxWidth <= 0) return path;
  if (mode === 'filename-fallback') {
    return fitFilenameFallback(path, maxWidth, measure);
  }
  return fitStartAndFilename(path, maxWidth, measure);
};

const buildCanvasTextMeasure = (element: HTMLElement): TextMeasureFn => {
  const isJsdom =
    typeof navigator !== 'undefined' && /\bjsdom\b/i.test(navigator.userAgent);
  if (isJsdom) {
    return (value: string) => value.length * 8;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const computedStyle = window.getComputedStyle(element);
  const fallbackFont = `${computedStyle.fontStyle} ${computedStyle.fontVariant} ${computedStyle.fontWeight} ${computedStyle.fontSize} / ${computedStyle.lineHeight} ${computedStyle.fontFamily}`;
  if (context) {
    context.font = computedStyle.font || fallbackFont;
  }
  return (value: string) => {
    if (!context) return value.length * 8;
    return context.measureText(value).width;
  };
};

export const useResponsivePathLabel = (path: string, mode: PathDisplayMode) => {
  const elementRef = useRef<HTMLElement | null>(null);
  const [label, setLabel] = useState(path);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      setLabel(path);
      return;
    }

    const measure = buildCanvasTextMeasure(element);
    const recalculate = () => {
      const width = Math.max(0, element.clientWidth);
      setLabel(fitPathToWidth(path, width, measure, mode));
    };

    recalculate();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => recalculate());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', recalculate);
    return () => {
      window.removeEventListener('resize', recalculate);
    };
  }, [path, mode]);

  return { elementRef, label };
};
