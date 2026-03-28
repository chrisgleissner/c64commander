from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("dump_c64_telnet_screens.py")
SPEC = importlib.util.spec_from_file_location("dump_c64_telnet_screens", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class DumpC64TelnetScreensTests(unittest.TestCase):
    def test_clean_menu_item_removes_border_artifacts(self) -> None:
        self.assertEqual(MODULE.clean_menu_item("│Run Cart     │"), "Run Cart")
        self.assertEqual(MODULE.clean_menu_item("PR│Run   │"), "Run")
        self.assertEqual(MODULE.clean_menu_item("PR───────┐"), "")

    def test_format_screen_dump_adds_labeled_header_and_footer(self) -> None:
        screen = MODULE.make_screen(["hello"])

        dump = MODULE.format_screen_dump(screen, "demo")

        self.assertTrue(dump.startswith("=== demo ===\nhello"))
        self.assertTrue(dump.endswith("==========="))

    def test_extract_menu_items_from_box(self) -> None:
        screen = MODULE.make_screen(
            [
                "                                                            ",
                "                              ┌──────────────┐                ",
                "                              │Enter         │                ",
                "                              │Rename        │                ",
                "                              │Delete        │                ",
                "                              └──────────────┘                ",
            ],
            reverse_rows={2: (31, 36)},
        )

        box = MODULE.choose_menu_box(screen)
        menu = MODULE.extract_menu_items(screen, box)

        self.assertEqual(menu["items"], ["Enter", "Rename", "Delete"])
        self.assertEqual(menu["selected_index"], 0)
        self.assertEqual(menu["selected_item"], "Enter")

    def test_extract_overlay_menu_items_from_merged_action_screen(self) -> None:
        screen = MODULE.make_screen(
            [
                "                                                            ",
                "                                                            ",
                "┌──────────────────────────────────────────────────────────┐",
                "│                                                          │",
                "│                                                          │",
                "│USB1    Verbat┌────────────────────────────┐     Ready    │",
                "│              │Power & Re─────────────────┐│              │",
                "│              │Built-in D│Reset C64       ││              │",
                "│              │Built-in D│Reboot C64      ││              │",
                "│              │Software I│Reboot (Clr Mem)││              │",
                "│              │Printer   │Power OFF       ││              │",
                "│              │Configurat│Power Cycle     ││              │",
                "│              │Streams   │Save C64 Memory ││              │",
                "│              │Developer │Save REU Memory ││              │",
                "│              │Return to └────────────────┘│              │",
                "│              └────────────────────────────┘              │",
                "│                                                          │",
                "└──────────────────────────────────────────────────────────┘",
            ]
        )

        overlay = MODULE.extract_overlay_menu_items(screen, MODULE.Box(left=15, top=5, right=44, bottom=15))

        self.assertIsNotNone(overlay)
        self.assertEqual(
            overlay["items"],
            [
                "Reset C64",
                "Reboot C64",
                "Reboot (Clr Mem)",
                "Power OFF",
                "Power Cycle",
                "Save C64 Memory",
                "Save REU Memory",
            ],
        )

    def test_collect_dropdown_options_from_windows_waits_for_real_scroll_end(self) -> None:
        windows = [[str(year) for year in range(1980, 1997)]] * 17
        windows += [[str(year) for year in range(start, start + 17)] for start in range(1981, 2006)]
        windows += [[str(year) for year in range(2009, 2026)]] * 24

        options = MODULE.collect_dropdown_options_from_windows(windows)

        self.assertIn("1980", options)
        self.assertIn("2025", options)
        self.assertGreater(len(options), 17)

    def test_resolve_output_paths_substitutes_firmware_version(self) -> None:
        output = Path("docs/c64/c64u-telnet.yaml")
        paths = MODULE.resolve_output_paths(
            output,
            "docs/c64/devices/c64u/{firmware_version}/c64u-telnet.yaml",
            "1.1.0",
        )

        self.assertEqual(
            paths,
            [
                Path("docs/c64/c64u-telnet.yaml"),
                Path("docs/c64/devices/c64u/1.1.0/c64u-telnet.yaml"),
            ],
        )

    def test_build_file_type_menu_definitions_uses_file_type_keys(self) -> None:
        definitions = MODULE.build_file_type_menu_definitions(
            [
                {
                    "label": "sid",
                    "path": "/USB1/test-data/SID/10_Orbyte.sid",
                    "menu_items": ["Play Main Tune", "Show Info", "View", "Rename", "Delete"],
                    "default_item": "Play Main Tune",
                },
                {
                    "label": "mod",
                    "path": "/USB1/test-data/mod/jukebox_packtune.mod",
                    "menu_items": ["Play MOD", "Load into REU", "Rename"],
                    "default_item": "Play MOD",
                },
            ]
        )

        self.assertEqual(list(definitions.keys()), ["mod", "sid"])
        self.assertEqual(definitions["sid"]["representative_file"], "/USB1/test-data/SID/10_Orbyte.sid")
        self.assertEqual(definitions["mod"]["default_item"], "Play MOD")

    def test_build_menu_tree_node_includes_nested_submenus(self) -> None:
        node = MODULE.build_menu_tree_node(
            {
                "items": ["Configuration", "Return to Main Menu"],
                "selected_item": "Configuration",
            },
            {
                "Configuration": {
                    "items": ["Save to Flash", "Reset to Defaults"],
                    "default_item": "Save to Flash",
                }
            },
        )

        self.assertEqual(node["items"], ["Configuration", "Return to Main Menu"])
        self.assertEqual(node["default_item"], "Configuration")
        self.assertIn("submenus", node)
        self.assertEqual(node["submenus"]["Configuration"]["items"], ["Save to Flash", "Reset to Defaults"])

    def test_build_telnet_document_includes_action_menu_nodes(self) -> None:
        document = MODULE.build_telnet_document(
            base_url="http://c64u",
            host="c64u",
            metadata={
                "device_type": "C64 Ultimate",
                "firmware_version": "1.1.0",
                "rest_api_version": "0.1",
            },
            requested_test_data_paths=["/USB0/test-data", "/USB1/test-data"],
            resolved_test_data_path="/USB1/test-data",
            initial_action_menus={
                "opened_with": "F1",
                "screen_context": "initial telnet screen with no selected filesystem entry",
                "action_menu": {
                    "items": ["Power & Reset", "Configuration"],
                    "default_item": "Power & Reset",
                },
            },
            selected_directory_action_menus={
                "path": "/USB1/test-data",
                "browser_path": "/USB1/",
                "selected_entry": "test-data",
                "opened_with": "F1",
                "action_menu": {
                    "items": ["Configuration", "Streams"],
                    "default_item": "Configuration",
                },
            },
            directory_menu_capture={
                "browser_path": "/USB1/",
                "selected_entry": "test-data",
                "menu_items": ["Enter", "Rename", "Delete"],
                "default_item": "Enter",
            },
            menu_definitions={
                "prg": {
                    "representative_file": "/USB1/test-data/prg/1k-mini-bdash-note.prg",
                    "items": ["Enter", "Rename", "Delete"],
                    "default_item": "Enter",
                }
            },
        )

        self.assertIn("initial_action_menus", document["telnet"])
        self.assertIn("selected_directory_action_menus", document["telnet"])
        self.assertEqual(document["telnet"]["initial_action_menus"]["opened_with"], "F1")
        self.assertEqual(document["telnet"]["selected_directory_action_menus"]["screen_context"], "filesystem browser with a directory selected and the action menu opened via function key")
        self.assertEqual(document["telnet"]["filesystem_context_menus"]["screen_context"], "filesystem browser with a selected entry and its ENTER-opened context menu")
        self.assertEqual(document["telnet"]["filesystem_context_menus"]["menu_definitions"]["prg"]["representative_file"], "/USB1/test-data/prg/1k-mini-bdash-note.prg")
        self.assertIn("filesystem_context_menus", document["telnet"])
        self.assertNotIn("commoserve", document["telnet"])


if __name__ == "__main__":
    unittest.main()
