import * as React from "react";

import { assertOverlayRespectsBadgeSafeZone, resolveCenteredOverlayLayout } from "@/components/ui/interstitialStyles";

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

      const rect = element.getBoundingClientRect();
      const contentHeight = Math.max(1, Math.round(rect.height || element.offsetHeight || 0));
      const { top, maxHeight } = resolveCenteredOverlayLayout(contentHeight);

      setStyle((current) => {
        const nextTop = `${top}px`;
        const nextMaxHeight = `${maxHeight}px`;
        if (current?.top === nextTop && current?.maxHeight === nextMaxHeight) {
          return current;
        }

        return {
          top: nextTop,
          maxHeight: nextMaxHeight,
          transform: "translateX(-50%)",
        };
      });

      assertOverlayRespectsBadgeSafeZone(
        {
          top,
          right: rect.right,
          bottom: top + contentHeight,
          left: rect.left,
        },
        overlayName,
      );
    };

    updateLayout();

    const element = localRef.current;
    if (!element) return undefined;

    let observer: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      observer = new ResizeObserver(() => updateLayout());
      observer.observe(element);
    }

    window.addEventListener("resize", updateLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
    };
  }, [nodeVersion, overlayName]);

  return { composedRef, style };
}
