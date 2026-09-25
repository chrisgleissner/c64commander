import * as React from "react";

import {
  assertOverlayRespectsBadgeSafeZone,
  boundsFromElement,
  resolveCenteredOverlayLayout,
  resolveWorkflowSheetLayout,
} from "@/components/ui/interstitialStyles";
import { KEYPAD_GUIDANCE_RESERVE_EVENT } from "@/lib/ui/keypadGuidanceReserve";
import { getInputModality } from "@/lib/input/inputModality";

const assignRef = <T>(ref: React.ForwardedRef<T>, value: T | null) => {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
};

/**
 * `enabled` is false for a surface that covers the whole screen. Such a surface is opaque and
 * starts at the top, so there is no badge or header underneath it left to keep clear, and the
 * centring transform this hook applies would push it half its own width off screen.
 */
export function useCenteredOverlayPosition<T extends HTMLElement>(
  forwardedRef: React.ForwardedRef<T>,
  overlayName: string,
  enabled = true,
) {
  return useOverlayPosition(forwardedRef, overlayName, enabled, (element) => {
    const rect = element.getBoundingClientRect();
    const contentHeight = Math.max(1, Math.round(rect.height || element.offsetHeight || 0));
    const { top, maxHeight } = resolveCenteredOverlayLayout(contentHeight);

    return {
      style: {
        top: `${top}px`,
        maxHeight: `${maxHeight}px`,
        transform: "translateX(-50%)",
      },
    };
  });
}

export function useWorkflowSheetPosition<T extends HTMLElement>(
  forwardedRef: React.ForwardedRef<T>,
  overlayName: string,
) {
  return useOverlayPosition(forwardedRef, overlayName, true, () => {
    const { top } = resolveWorkflowSheetLayout();
    return {
      style: {
        top: `${top}px`,
        // A caller that sets its own height needs this to bound it: `top` is explicit, so an
        // explicit height is measured downwards from it and `bottom-0` no longer constrains it.
        "--app-sheet-top-clearance": `${top}px`,
      } as React.CSSProperties,
    };
  });
}

/**
 * A surface that shrinks, for one when the keypad guidance bar appears under it, can leave the
 * control a keypad user is on outside its scroll area, and nothing else would bring it back.
 */
const keepKeypadFocusInView = (surface: HTMLElement) => {
  if (getInputModality() !== "key-navigation") return;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== surface && surface.contains(focused)) {
    focused.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
};

function useOverlayPosition<T extends HTMLElement>(
  forwardedRef: React.ForwardedRef<T>,
  overlayName: string,
  enabled: boolean,
  resolveStyle: (element: T) => { style: React.CSSProperties },
) {
  const localRef = React.useRef<T | null>(null);
  const attachedNodeRef = React.useRef<T | null>(null);
  const [nodeVersion, setNodeVersion] = React.useState(0);
  const [style, setStyle] = React.useState<React.CSSProperties | undefined>(undefined);

  const composedRef = React.useMemo(
    () => (node: T | null) => {
      localRef.current = node;
      assignRef(forwardedRef, node);

      if (node && node !== attachedNodeRef.current) {
        attachedNodeRef.current = node;
        setNodeVersion((current) => current + 1);
      }
    },
    [forwardedRef],
  );

  React.useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!enabled) {
      setStyle(undefined);
      return undefined;
    }

    const updateLayout = () => {
      const element = localRef.current;
      if (!element) return;

      setStyle((current) => {
        const next = resolveStyle(element).style;
        if (JSON.stringify(current) === JSON.stringify(next)) {
          return current;
        }

        return next;
      });

      window.requestAnimationFrame(() => {
        const updatedElement = localRef.current;
        if (!updatedElement) return;
        keepKeypadFocusInView(updatedElement);
        const bounds = boundsFromElement(updatedElement);
        if (bounds.left === 0 && bounds.right === 0 && bounds.top === 0 && bounds.bottom === 0) {
          const fallbackTop = Number.parseFloat(updatedElement.style.top || "0");
          assertOverlayRespectsBadgeSafeZone(fallbackTop, overlayName);
          return;
        }

        assertOverlayRespectsBadgeSafeZone(bounds, overlayName);
      });
    };

    updateLayout();

    const element = localRef.current;
    if (!element) return undefined;

    let observer: ResizeObserver | null = null;
    const ResizeObserverCtor = window.ResizeObserver;
    if (typeof ResizeObserverCtor === "function") {
      observer = new ResizeObserverCtor(() => updateLayout());
      observer.observe(element);
    }

    window.addEventListener("resize", updateLayout);
    window.addEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, updateLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, updateLayout);
    };
  }, [enabled, nodeVersion, overlayName]);

  return { composedRef, nodeRef: localRef, nodeVersion, style };
}
