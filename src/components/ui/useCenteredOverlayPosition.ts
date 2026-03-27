import * as React from "react";

import {
  assertOverlayRespectsBadgeSafeZone,
  boundsFromElement,
  resolveCenteredOverlayLayout,
  resolveWorkflowSheetLayout,
} from "@/components/ui/interstitialStyles";

const assignRef = <T>(ref: React.ForwardedRef<T>, value: T | null) => {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
};

export function useCenteredOverlayPosition<T extends HTMLElement>(
  forwardedRef: React.ForwardedRef<T>,
  overlayName: string,
) {
  return useOverlayPosition(forwardedRef, overlayName, (element) => {
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
  return useOverlayPosition(forwardedRef, overlayName, () => {
    const { top } = resolveWorkflowSheetLayout();
    return {
      style: {
        top: `${top}px`,
      },
    };
  });
}

function useOverlayPosition<T extends HTMLElement>(
  forwardedRef: React.ForwardedRef<T>,
  overlayName: string,
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
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
    };
  }, [nodeVersion, overlayName]);

  return { composedRef, nodeRef: localRef, nodeVersion, style };
}
