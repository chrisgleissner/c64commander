import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { DEFAULT_MENU_FIXTURE } from "@/../tests/contract/lib/telnetTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TelnetYamlDocument = {
  telnet?: {
    filesystem_context_menus?: {
      menu_definitions?: Record<
        string,
        {
          representative_file?: string;
          items?: string[];
          default_item?: string;
        }
      >;
    };
  };
};

const loadTelnetMenuDefinitions = (relativePath: string) => {
  const yamlPath = path.resolve(__dirname, "../../../", relativePath);
  const raw = fs.readFileSync(yamlPath, "utf8");
  const document = yaml.load(raw) as TelnetYamlDocument;
  return document.telnet?.filesystem_context_menus?.menu_definitions ?? {};
};

describe("telnet cfg contract", () => {
  it("defines the cfg file context menu in the contract fixture", () => {
    expect(DEFAULT_MENU_FIXTURE.browser.directories["/USB1/test-data/snapshots"]).toEqual(
      expect.arrayContaining([{ name: "config.cfg", type: "file" }]),
    );

    expect(DEFAULT_MENU_FIXTURE.filesystemContextMenus.menuDefinitions.cfg).toEqual({
      representativeFile: "/USB1/test-data/snapshots/config.cfg",
      items: ["Load Settings", "View", "Rename", "Delete"],
      defaultItem: "Load Settings",
    });
  });

  it("keeps both telnet yaml mirrors aligned with the cfg menu definition", () => {
    const expected = {
      representative_file: "/USB1/test-data/snapshots/config.cfg",
      items: ["Load Settings", "View", "Rename", "Delete"],
      default_item: "Load Settings",
    };

    expect(loadTelnetMenuDefinitions("docs/c64/c64u-telnet.yaml").cfg).toEqual(expected);
    expect(loadTelnetMenuDefinitions("docs/c64/devices/c64u/1.1.0/c64u-telnet.yaml").cfg).toEqual(expected);
  });
});
