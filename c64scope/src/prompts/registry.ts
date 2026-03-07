/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { prompts, type PromptArgument, type PromptDefinition } from "../promptDefinitions.js";

export interface PromptDescriptor {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly requiredResources: readonly string[];
  readonly tools: readonly string[];
}

export interface PromptSegment {
  readonly id: string;
  readonly role: "assistant" | "user" | "system";
  readonly content: string;
}

interface PromptEntry {
  readonly descriptor: PromptDescriptor;
  readonly arguments?: readonly PromptArgument[];
  readonly buildMessages: (args: Record<string, string>) => readonly PromptSegment[];
}

export interface PromptListEntry {
  readonly descriptor: PromptDescriptor;
  readonly arguments?: readonly PromptArgument[];
}

export interface ResolvedPrompt {
  readonly description: string;
  readonly messages: readonly PromptSegment[];
  readonly arguments: Record<string, string>;
  readonly resources: readonly string[];
  readonly tools: readonly string[];
}

function toEntry(prompt: PromptDefinition): PromptEntry {
  return {
    descriptor: {
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      requiredResources: prompt.requiredResources ?? [],
      tools: prompt.tools ?? [],
    },
    arguments: prompt.arguments,
    buildMessages: (args) => [
      {
        id: `${prompt.name}/user`,
        role: "user",
        content: prompt.render(args),
      },
    ],
  };
}

export function createPromptRegistry() {
  const entries = prompts.map(toEntry);
  const promptMap = new Map(entries.map((entry) => [entry.descriptor.name, entry]));

  return {
    list(): readonly PromptListEntry[] {
      return entries.map((entry) => ({
        descriptor: entry.descriptor,
        arguments: entry.arguments,
      }));
    },

    resolve(name: string, args: Record<string, unknown>): ResolvedPrompt {
      const entry = promptMap.get(name);
      if (!entry) {
        throw new Error(`Unknown prompt: ${name}`);
      }

      const normalizedArgs = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)]));

      return {
        description: entry.descriptor.description,
        messages: entry.buildMessages(normalizedArgs),
        arguments: normalizedArgs,
        resources: entry.descriptor.requiredResources,
        tools: entry.descriptor.tools,
      };
    },
  };
}
