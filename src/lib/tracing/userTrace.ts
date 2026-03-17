/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createActionContext, runWithActionTrace, runWithImplicitAction } from "@/lib/tracing/actionTrace";
import { addErrorLog, addLog, buildErrorLogDetails } from "@/lib/logging";
import React from "react";

type ComponentProps = Record<string, unknown>;

function getMeaningfulName(props: ComponentProps, defaultName: string): string {
  if (typeof props["aria-label"] === "string") return props["aria-label"];
  if (typeof props.title === "string") return props.title;
  if (typeof props.name === "string") return props.name;
  if (typeof props.id === "string") return props.id;

  if (typeof props.children === "string") {
    return props.children.slice(0, 30);
  }

  // Try to find text in children array (e.g. Button wrapping span)
  if (Array.isArray(props.children)) {
    const textChild = props.children.find((c: unknown) => typeof c === "string");
    if (typeof textChild === "string") return textChild.slice(0, 30);
  }

  // Common pattern: Button > span > text
  if (React.isValidElement(props.children)) {
    const child = props.children as React.ReactElement<ComponentProps>;
    if (typeof child.props?.children === "string") {
      return child.props.children.slice(0, 30);
    }
  }

  return defaultName;
}

type TracedEvent = { __c64uTraced?: boolean };
type EventWithNative = { nativeEvent?: TracedEvent & object };

export const wrapUserEvent = <E extends React.SyntheticEvent<Element> | Event, R>(
  handler: ((e: E) => R) | undefined,
  actionType: string,
  componentName: string,
  props: ComponentProps,
  defaultLabel: string = "Element",
): ((e: E) => Promise<void>) => {
  return async (e: E) => {
    (e as unknown as TracedEvent).__c64uTraced = true;
    const nativeEvent = (e as unknown as EventWithNative).nativeEvent;
    if (nativeEvent && typeof nativeEvent === "object") {
      nativeEvent.__c64uTraced = true;
    }
    const label = getMeaningfulName(props, defaultLabel);
    const actionName = `${actionType} ${label}`;

    const context = createActionContext(actionName, "user", componentName);

    await runWithActionTrace(context, async () => {
      if (handler) {
        await handler(e);
      }
    });
  };
};

export const wrapValueChange = <T, R>(
  handler: ((value: T) => R) | undefined,
  actionType: string,
  componentName: string,
  props: ComponentProps,
  defaultLabel: string = "Element",
): ((value: T) => Promise<void>) => {
  return async (value: T) => {
    const label = getMeaningfulName(props, defaultLabel);
    let valueStr = "";
    try {
      if (typeof value === "object") {
        valueStr = JSON.stringify(value).slice(0, 20);
      } else {
        valueStr = String(value);
      }
    } catch (error) {
      addLog("warn", "Failed to stringify traced value", { error: (error as Error).message });
      valueStr = "[complex]";
    }
    const actionName = `${actionType} ${label} [${valueStr}]`;

    const context = createActionContext(actionName, "user", componentName);

    await runWithActionTrace(context, async () => {
      if (handler) {
        await handler(value);
      }
    });
  };
};

export const emitUiTraceMarker = (name: string, details?: Record<string, unknown>) => {
  void runWithImplicitAction(name, () => undefined).catch((error) => {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    addErrorLog(
      "UI trace marker emission failed",
      buildErrorLogDetails(resolvedError, {
        marker: name,
        details: details ?? null,
      }),
    );
  });
};
