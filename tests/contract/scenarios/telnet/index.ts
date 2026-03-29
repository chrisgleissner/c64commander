/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HarnessConfig } from "../../lib/config.js";
import type { LogEventInput } from "../../lib/logging.js";
import { TelnetClient } from "../../lib/telnetClient.js";

export type TelnetScenarioContext = {
  config: HarnessConfig;
  log: (event: LogEventInput) => void;
};

export type TelnetScenario = {
  id: string;
  safe: boolean;
  run: (ctx: TelnetScenarioContext) => Promise<void>;
};

export function buildTelnetScenarios(): TelnetScenario[] {
  return [
    {
      id: "telnet.menu-tree",
      safe: true,
      run: async ({ config, log }) => {
        const client = new TelnetClient({
          host: new URL(config.baseUrl).hostname,
          port: config.telnetPort ?? 23,
          password: config.auth === "ON" ? config.password || "" : undefined,
          timeoutMs: config.health.timeoutMs,
        });

        try {
          await client.connect();
          const initialScreen = await client.readScreen();
          log({
            kind: "telnet",
            op: "connect",
            status: "ok",
            details: {
              promptedForPassword: client.promptedForPassword,
              titleLine: initialScreen.titleLine,
              screenType: initialScreen.screenType,
            },
          });

          await client.sendKey("F5");
          const menuScreen = await client.readScreen();
          const categories = menuScreen.menus[0]?.items.map((item) => item.label) ?? [];
          log({
            kind: "telnet",
            op: "menu.categories",
            status: categories.length > 0 ? "ok" : "missing",
            details: { categories },
          });

          const tree: Array<{ category: string; actions: string[] }> = [];
          for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
            if (categoryIndex > 0) {
              await client.sendKey("DOWN");
              await client.readScreen();
            }
            await client.sendKey("RIGHT");
            const submenuScreen = await client.readScreen();
            tree.push({
              category: categories[categoryIndex],
              actions: submenuScreen.menus[1]?.items.map((item) => item.label) ?? [],
            });
            await client.sendKey("LEFT");
            await client.readScreen();
          }

          log({
            kind: "telnet",
            op: "menu.tree",
            status: "ok",
            details: { tree },
          });
        } finally {
          await client.close().catch((error) => {
            console.warn("Failed to close Telnet scenario client", { error: String(error) });
          });
        }
      },
    },
  ];
}
