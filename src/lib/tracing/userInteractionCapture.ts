/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createActionContext, runWithActionTrace } from '@/lib/tracing/actionTrace';

const INSTALL_FLAG = '__c64uUserInteractionCaptureInstalled';
const COMPONENT_NAME = 'GlobalInteraction';

const isElement = (value: unknown): value is Element =>
  typeof value === 'object' && value !== null && 'nodeType' in (value as any) && (value as any).nodeType === 1;

const getAriaLabelledByText = (element: Element) => {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (!labelledBy) return null;
  const ids = labelledBy.split(/\s+/).map((id) => id.trim()).filter(Boolean);
  for (const id of ids) {
    const labelEl = document.getElementById(id);
    const text = labelEl?.textContent?.trim();
    if (text) return text;
  }
  return null;
};

const getMeaningfulLabel = (element: Element) => {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  const ariaLabelledBy = getAriaLabelledByText(element);
  if (ariaLabelledBy) return ariaLabelledBy;

  const testId = element.getAttribute('data-testid')?.trim();
  if (testId) return testId;

  const title = element.getAttribute('title')?.trim();
  if (title) return title;

  const id = (element as HTMLElement).id?.trim();
  if (id) return id;

  const name = (element as HTMLElement).getAttribute?.('name')?.trim();
  if (name) return name;

  const text = element.textContent?.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);

  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role')?.trim();
  return role ? `${tag}[role=${role}]` : tag;
};

const isPrimaryInteractive = (element: Element) => {
  const tag = element.tagName.toLowerCase();
  if (tag === 'button' || tag === 'a' || tag === 'select' || tag === 'textarea') return true;
  if (tag === 'input') return true;

  const role = element.getAttribute('role');
  if (!role) return false;
  return [
    'button',
    'checkbox',
    'switch',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'slider',
    'radio',
    'link',
  ].includes(role);
};

const isFallbackInteractive = (element: Element) => {
  if (element.getAttribute('data-testid')) return true;
  if (element.getAttribute('data-cta')) return true;
  if (element.getAttribute('data-action')) return true;
  if (element.getAttribute('aria-label')) return true;
  if (element.getAttribute('aria-labelledby')) return true;
  if (element.getAttribute('title')) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  const tabIndex = (element as HTMLElement).tabIndex;
  return typeof tabIndex === 'number' && tabIndex >= 0;
};

const hasDiagnosticsOpenTrigger = (element: Element) =>
  typeof element.closest === 'function' && element.closest('[data-diagnostics-open-trigger]');

const isDiagnosticsOpenTrigger = (element: Element, event?: Event) => {
  if (hasDiagnosticsOpenTrigger(element)) return true;
  if (!event) return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.some((candidate) => isElement(candidate) && hasDiagnosticsOpenTrigger(candidate));
};

const findInteractiveTarget = (event: Event) => {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const candidate of path) {
    if (!isElement(candidate)) continue;
    if (candidate.tagName.toLowerCase() === 'body') break;
    if (isPrimaryInteractive(candidate)) return candidate;
  }
  for (const candidate of path) {
    if (!isElement(candidate)) continue;
    if (candidate.tagName.toLowerCase() === 'body') break;
    if (isFallbackInteractive(candidate)) return candidate;
  }
  if (isElement(event.target)) {
    if (isPrimaryInteractive(event.target) || isFallbackInteractive(event.target)) return event.target;
  }
  return null;
};

const traceInteraction = async (action: string, element: Element, event: Event) => {
  // Avoid double-tracing when a component wrapper already captured the interaction.
  if ((event as any).__c64uTraced) return;
  if (isDiagnosticsOpenTrigger(element, event)) return;

  (event as any).__c64uTraced = true;

  const label = getMeaningfulLabel(element);
  const name = `${action} ${label}`;
  const context = createActionContext(name, 'user', COMPONENT_NAME);

  // Set up the context BEFORE the actual handler runs.
  // We use a setTimeout(0) to keep the context active until AFTER the handler's
  // synchronous work completes. This includes any fire-and-forget async calls
  // started synchronously (like `void loadEntries(path)`).
  await runWithActionTrace(context, async () => {
    // Wait for all synchronous work from the event handler to complete.
    // The setTimeout(0) defers until after the current event loop tick,
    // allowing the handler to execute with the context still active.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
};

export const registerUserInteractionCapture = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if ((window as any)[INSTALL_FLAG]) return;
  (window as any)[INSTALL_FLAG] = true;

  const onClick = (event: Event) => {
    const element = findInteractiveTarget(event);
    if (!element) return;
    void traceInteraction('click', element, event);
  };

  // Use change (not input) to avoid tracing every keystroke.
  const onChange = (event: Event) => {
    const element = findInteractiveTarget(event);
    if (!element) return;
    void traceInteraction('change', element, event);
  };

  // Sliders (Radix) often don't emit native change events.
  const onPointerUp = (event: Event) => {
    const element = findInteractiveTarget(event);
    if (!element) return;
    const role = element.getAttribute('role');
    const tag = element.tagName.toLowerCase();
    const isRange = tag === 'input' && (element as HTMLInputElement).type?.toLowerCase?.() === 'range';
    if (role !== 'slider' && !isRange) return;
    void traceInteraction('slide', element, event);
  };

  // Use capture phase so context is set BEFORE React handlers execute.
  // This allows the async context to propagate to work scheduled by those handlers.
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('change', onChange, { capture: true });
  document.addEventListener('pointerup', onPointerUp, { capture: true });
};
