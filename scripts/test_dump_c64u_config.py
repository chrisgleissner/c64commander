from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("dump_c64u_config.py")
SPEC = importlib.util.spec_from_file_location("dump_c64u_config", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class DumpC64UConfigTests(unittest.TestCase):
    def test_resolve_output_paths_substitutes_firmware_version(self) -> None:
        output = Path("docs/c64/c64u-config.yaml")

        paths = MODULE.resolve_output_paths(
            output,
            "docs/c64/devices/c64u/{firmware_version}/c64u-config.yaml",
            "1.1.0",
        )

        self.assertEqual(
            paths,
            [
                Path("docs/c64/c64u-config.yaml"),
                Path("docs/c64/devices/c64u/1.1.0/c64u-config.yaml"),
            ],
        )

    def test_build_cfg_text_uses_selected_values_in_category_order(self) -> None:
        snapshot = {
            "config": {
                "categories": {
                    "Audio Mixer": {
                        "items": {
                            "Vol UltiSid 1": {"selected": " 0 dB", "options": ["OFF", " 0 dB"]},
                            "Vol Drive 1": {"selected": "OFF"},
                        }
                    },
                    "Network Settings": {
                        "items": {
                            "Host Name": {"selected": "c64u"},
                            "Network Password": {"selected": "********"},
                            "Log to Syslog Server": {"selected": ""},
                        }
                    },
                }
            }
        }

        cfg_text = MODULE.build_cfg_text(snapshot)

        self.assertEqual(
            cfg_text,
            "[Audio Mixer]\n"
            "Vol UltiSid 1= 0 dB\n"
            "Vol Drive 1=OFF\n"
            "\n"
            "[Network Settings]\n"
            "Host Name=c64u\n"
            "Network Password=********\n"
            "Log to Syslog Server=\n",
        )

    def test_build_cfg_text_writes_blank_line_between_categories_and_trailing_newline(self) -> None:
        snapshot = {
            "config": {
                "categories": {
                    "Only Category": {
                        "items": {
                            "Empty": {"selected": ""},
                            "Unset": {"selected": None},
                        }
                    }
                }
            }
        }

        cfg_text = MODULE.build_cfg_text(snapshot)

        self.assertEqual(cfg_text, "[Only Category]\nEmpty=\nUnset=\n")


if __name__ == "__main__":
    unittest.main()
