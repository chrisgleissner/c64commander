/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createActionContext, runWithActionTrace } from '@/lib/tracing/actionTrace';
import React from 'react';

function getMeaningfulName(props: any, defaultName: string): string {
  if (props['aria-label']) return props['aria-label'];
  if (props.title) return props.title;
  if (props.name) return props.name;
  if (props.id) return props.id;

  if (typeof props.children === 'string') {
    return props.children.slice(0, 30);
  }

  // Try to find text in children array (e.g. Button wrapping span)
  if (Array.isArray(props.children)) {
    const textChild = props.children.find((c: any) => typeof c === 'string');
    if (textChild) return textChild.slice(0, 30);
  }

  // Common pattern: Button > span > text
  if (React.isValidElement(props.children)) {
     const child = props.children as React.ReactElement<any>;
     if (typeof child.props?.children === 'string') {
        return child.props.children.slice(0, 30);
     }
  }

  return defaultName;
}

export const wrapUserEvent = <E extends React.SyntheticEvent<any> | Event, R>(
  handler: ((e: E) => R) | undefined,
  actionType: string,
  componentName: string,
  props: any,
  defaultLabel: string = 'Element'
): ((e: E) => Promise<void>) => {
  return async (e: E) => {
    (e as any).__c64uTraced = true;
    const nativeEvent = (e as any).nativeEvent;
    if (nativeEvent && typeof nativeEvent === 'object') {
      (nativeEvent as any).__c64uTraced = true;
    }
    const label = getMeaningfulName(props, defaultLabel);
    const actionName = `${actionType} ${label}`;

    const context = createActionContext(actionName, 'user', componentName);

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
  props: any,
  defaultLabel: string = 'Element'
): ((value: T) => Promise<void>) => {
  return async (value: T) => {
    const label = getMeaningfulName(props, defaultLabel);
    let valueStr = '';
    try {
        if (typeof value === 'object') {
            valueStr = JSON.stringify(value).slice(0, 20);
        } else {
            valueStr = String(value);
        }
    } catch (error) {
      console.warn('Failed to stringify traced value', { error });
        valueStr = '[complex]';
    }
    const actionName = `${actionType} ${label} [${valueStr}]`;

    const context = createActionContext(actionName, 'user', componentName);

    await runWithActionTrace(context, async () => {
      if (handler) {
        await handler(value);
      }
    });
  };
};
