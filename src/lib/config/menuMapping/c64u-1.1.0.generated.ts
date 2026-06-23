/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: src/lib/config/menuMapping/c64u-1.1.0.association.yaml (+ its referenced menu/config YAMLs).
// Regenerate: npm run menu-mapping:compile  (validated by npm run menu-mapping:check).

import type { MenuHierarchy, TerminologyOverlay } from "./types";

/** Layer B — the captured C64U 1.1.0 menu hierarchy. */
export const C64U_1_1_0_HIERARCHY: MenuHierarchy = {
  "family": "C64U",
  "firmwareVersion": "1.1.0",
  "nodes": [
    {
      "label": "Memory & ROMs",
      "kind": "page",
      "path": [
        "Memory & ROMs"
      ],
      "children": [
        {
          "label": "Kernal ROM",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "Kernal ROM"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "Kernal ROM"
          }
        },
        {
          "label": "BASIC ROM",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "BASIC ROM"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "Basic ROM"
          }
        },
        {
          "label": "Character ROM",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "Character ROM"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "Char ROM"
          }
        },
        {
          "label": "Cartridge",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "Cartridge"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "Cartridge"
          }
        },
        {
          "label": "RAM expansion unit",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "RAM expansion unit"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "RAM Expansion Unit"
          }
        },
        {
          "label": "Size",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "Size"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "REU Size"
          }
        },
        {
          "label": "Command interface",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "Command interface"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "Command Interface"
          }
        },
        {
          "label": "Ultimate audio",
          "kind": "item",
          "path": [
            "Memory & ROMs",
            "Ultimate audio"
          ],
          "rest": {
            "category": "C64 and Cartridge Settings",
            "item": "Map Ultimate Audio $DF20-DFFF"
          }
        },
        {
          "label": "Drive A",
          "kind": "section",
          "path": [
            "Memory & ROMs",
            "Drive A"
          ],
          "children": [
            {
              "label": "ROM for 1541 mode",
              "kind": "item",
              "path": [
                "Memory & ROMs",
                "Drive A",
                "ROM for 1541 mode"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "ROM for 1541 mode"
              },
              "alias": true
            },
            {
              "label": "ROM for 1571 mode",
              "kind": "item",
              "path": [
                "Memory & ROMs",
                "Drive A",
                "ROM for 1571 mode"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "ROM for 1571 mode"
              },
              "alias": true
            },
            {
              "label": "ROM for 1581 mode",
              "kind": "item",
              "path": [
                "Memory & ROMs",
                "Drive A",
                "ROM for 1581 mode"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "ROM for 1581 mode"
              },
              "alias": true
            }
          ]
        },
        {
          "label": "Drive B",
          "kind": "section",
          "path": [
            "Memory & ROMs",
            "Drive B"
          ],
          "children": [
            {
              "label": "ROM for 1541 mode",
              "kind": "item",
              "path": [
                "Memory & ROMs",
                "Drive B",
                "ROM for 1541 mode"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "ROM for 1541 mode"
              },
              "alias": true
            },
            {
              "label": "ROM for 1571 mode",
              "kind": "item",
              "path": [
                "Memory & ROMs",
                "Drive B",
                "ROM for 1571 mode"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "ROM for 1571 mode"
              },
              "alias": true
            },
            {
              "label": "ROM for 1581 mode",
              "kind": "item",
              "path": [
                "Memory & ROMs",
                "Drive B",
                "ROM for 1581 mode"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "ROM for 1581 mode"
              },
              "alias": true
            }
          ]
        }
      ]
    },
    {
      "label": "Turbo boost",
      "kind": "page",
      "path": [
        "Turbo boost"
      ],
      "children": [
        {
          "label": "Turbo control",
          "kind": "item",
          "path": [
            "Turbo boost",
            "Turbo control"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "Turbo Control"
          }
        },
        {
          "label": "CPU speed",
          "kind": "item",
          "path": [
            "Turbo boost",
            "CPU speed"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "CPU Speed"
          },
          "formatterId": "cpuSpeedMhz"
        },
        {
          "label": "Badline timing",
          "kind": "item",
          "path": [
            "Turbo boost",
            "Badline timing"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "Badline Timing"
          }
        },
        {
          "label": "SuperCPU detect (D0BC)",
          "kind": "item",
          "path": [
            "Turbo boost",
            "SuperCPU detect (D0BC)"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "SuperCPU Detect (D0BC)"
          }
        }
      ]
    },
    {
      "label": "Video setup",
      "kind": "page",
      "path": [
        "Video setup"
      ],
      "children": [
        {
          "label": "System mode",
          "kind": "item",
          "path": [
            "Video setup",
            "System mode"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "System Mode"
          }
        },
        {
          "label": "HDMI scan resolution",
          "kind": "item",
          "path": [
            "Video setup",
            "HDMI scan resolution"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "HDMI Scan Resolution"
          }
        },
        {
          "label": "HDMI scan lines",
          "kind": "item",
          "path": [
            "Video setup",
            "HDMI scan lines"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "HDMI Scan lines"
          }
        },
        {
          "label": "Palette definition",
          "kind": "item",
          "path": [
            "Video setup",
            "Palette definition"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "Palette Definition"
          }
        },
        {
          "label": "Analog video mode",
          "kind": "item",
          "path": [
            "Video setup",
            "Analog video mode"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "Analog Video Mode"
          }
        },
        {
          "label": "Digital video mode",
          "kind": "item",
          "path": [
            "Video setup",
            "Digital video mode"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "Digital Video Mode"
          }
        }
      ]
    },
    {
      "label": "Audio setup",
      "kind": "group",
      "path": [
        "Audio setup"
      ],
      "children": [
        {
          "label": "Audio mixer",
          "kind": "page",
          "path": [
            "Audio setup",
            "Audio mixer"
          ],
          "children": [
            {
              "label": "Vol UltiSID 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol UltiSID 1"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol UltiSid 1"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol UltiSID 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol UltiSID 2"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol UltiSid 2"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol socket 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol socket 1"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Socket 1"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol socket 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol socket 2"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Socket 2"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol sampler L",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol sampler L"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Sampler L"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol sampler R",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol sampler R"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Sampler R"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol drive 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol drive 1"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Drive 1"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol drive 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol drive 2"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Drive 2"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol tape read",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol tape read"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Tape Read"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol tape write",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Vol tape write"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Vol Tape Write"
              },
              "formatterId": "db"
            },
            {
              "label": "Pan UltiSID 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan UltiSID 1"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan UltiSID 1"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan UltiSID 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan UltiSID 2"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan UltiSID 2"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan socket 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan socket 1"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Socket 1"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan socket 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan socket 2"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Socket 2"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan sampler L",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan sampler L"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Sampler L"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan sampler R",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan sampler R"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Sampler R"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan drive 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan drive 1"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Drive 1"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan drive 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan drive 2"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Drive 2"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan tape read",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan tape read"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Tape Read"
              },
              "formatterId": "pan"
            },
            {
              "label": "Pan tape write",
              "kind": "item",
              "path": [
                "Audio setup",
                "Audio mixer",
                "Pan tape write"
              ],
              "rest": {
                "category": "Audio Mixer",
                "item": "Pan Tape Write"
              },
              "formatterId": "pan"
            }
          ]
        },
        {
          "label": "Speaker mixer",
          "kind": "page",
          "path": [
            "Audio setup",
            "Speaker mixer"
          ],
          "children": [
            {
              "label": "Speaker enable",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Speaker enable"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Speaker Enable"
              }
            },
            {
              "label": "Vol UltiSID 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol UltiSID 1"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol UltiSid 1"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol UltiSID 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol UltiSID 2"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol UltiSid 2"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol socket 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol socket 1"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Socket 1"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol socket 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol socket 2"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Socket 2"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol sampler L",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol sampler L"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Sampler L"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol sampler R",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol sampler R"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Sampler R"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol drive 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol drive 1"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Drive 1"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol drive 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol drive 2"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Drive 2"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol tape read",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol tape read"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Tape Read"
              },
              "formatterId": "db"
            },
            {
              "label": "Vol tape write",
              "kind": "item",
              "path": [
                "Audio setup",
                "Speaker mixer",
                "Vol tape write"
              ],
              "rest": {
                "category": "Speaker Mixer",
                "item": "Vol Tape Write"
              },
              "formatterId": "db"
            }
          ]
        },
        {
          "label": "SID sockets configuration",
          "kind": "page",
          "path": [
            "Audio setup",
            "SID sockets configuration"
          ],
          "children": [
            {
              "label": "SID socket 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID socket 1"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Socket 1"
              }
            },
            {
              "label": "SID socket 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID socket 2"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Socket 2"
              }
            },
            {
              "label": "SID detected socket 1",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID detected socket 1"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Detected Socket 1"
              }
            },
            {
              "label": "SID detected socket 2",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID detected socket 2"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Detected Socket 2"
              }
            },
            {
              "label": "SID socket 1 1K ohm resistor",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID socket 1 1K ohm resistor"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Socket 1 1K Ohm Resistor"
              }
            },
            {
              "label": "SID socket 2 1K ohm resistor",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID socket 2 1K ohm resistor"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Socket 2 1K Ohm Resistor"
              }
            },
            {
              "label": "SID socket 1 capacitors",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID socket 1 capacitors"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Socket 1 Capacitors"
              }
            },
            {
              "label": "SID socket 2 capacitors",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID sockets configuration",
                "SID socket 2 capacitors"
              ],
              "rest": {
                "category": "SID Sockets Configuration",
                "item": "SID Socket 2 Capacitors"
              }
            }
          ]
        },
        {
          "label": "UltiSID configuration",
          "kind": "page",
          "path": [
            "Audio setup",
            "UltiSID configuration"
          ],
          "children": [
            {
              "label": "UltiSID 1 filter curve",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 1 filter curve"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 1 Filter Curve"
              }
            },
            {
              "label": "UltiSID 2 filter curve",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 2 filter curve"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 2 Filter Curve"
              }
            },
            {
              "label": "UltiSID 1 filter resonance",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 1 filter resonance"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 1 Filter Resonance"
              }
            },
            {
              "label": "UltiSID 2 filter resonance",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 2 filter resonance"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 2 Filter Resonance"
              }
            },
            {
              "label": "UltiSID 1 combined waveforms",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 1 combined waveforms"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 1 Combined Waveforms"
              }
            },
            {
              "label": "UltiSID 2 combined waveforms",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 2 combined waveforms"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 2 Combined Waveforms"
              }
            },
            {
              "label": "UltiSID 1 digis level",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 1 digis level"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 1 Digis Level"
              }
            },
            {
              "label": "UltiSID 2 digis level",
              "kind": "item",
              "path": [
                "Audio setup",
                "UltiSID configuration",
                "UltiSID 2 digis level"
              ],
              "rest": {
                "category": "UltiSID Configuration",
                "item": "UltiSID 2 Digis Level"
              }
            }
          ]
        },
        {
          "label": "SID addressing",
          "kind": "page",
          "path": [
            "Audio setup",
            "SID addressing"
          ],
          "children": [
            {
              "label": "SID socket 1 address",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "SID socket 1 address"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "SID Socket 1 Address"
              },
              "formatterId": "address"
            },
            {
              "label": "SID socket 2 address",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "SID socket 2 address"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "SID Socket 2 Address"
              },
              "formatterId": "address"
            },
            {
              "label": "Ext DualSID range split",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "Ext DualSID range split"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "Ext DualSID Range Split"
              }
            },
            {
              "label": "UltiSID 1 address",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "UltiSID 1 address"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "UltiSID 1 Address"
              },
              "formatterId": "address"
            },
            {
              "label": "UltiSID 2 address",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "UltiSID 2 address"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "UltiSID 2 Address"
              },
              "formatterId": "address"
            },
            {
              "label": "UltiSID range split",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "UltiSID range split"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "UltiSID Range Split"
              }
            },
            {
              "label": "Paddle override",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "Paddle override"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "Paddle Override"
              }
            },
            {
              "label": "Auto addr mirroring",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID addressing",
                "Auto addr mirroring"
              ],
              "rest": {
                "category": "SID Addressing",
                "item": "Auto Address Mirroring"
              }
            },
            {
              "label": "Visual SID address editor",
              "kind": "menuOnly",
              "path": [
                "Audio setup",
                "SID addressing",
                "Visual SID address editor"
              ]
            }
          ]
        },
        {
          "label": "SID player behavior",
          "kind": "page",
          "path": [
            "Audio setup",
            "SID player behavior"
          ],
          "children": [
            {
              "label": "SID player autoconfig",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID player behavior",
                "SID player autoconfig"
              ],
              "rest": {
                "category": "U64 Specific Settings",
                "item": "SID Player Autoconfig"
              }
            },
            {
              "label": "Allow autoconfig uses UltiSID",
              "kind": "item",
              "path": [
                "Audio setup",
                "SID player behavior",
                "Allow autoconfig uses UltiSID"
              ],
              "rest": {
                "category": "U64 Specific Settings",
                "item": "Allow Autoconfig uses UltiSid"
              }
            }
          ]
        }
      ]
    },
    {
      "label": "Joystick & controllers",
      "kind": "page",
      "path": [
        "Joystick & controllers"
      ],
      "children": [
        {
          "label": "Joystick input",
          "kind": "item",
          "path": [
            "Joystick & controllers",
            "Joystick input"
          ],
          "rest": {
            "category": "U64 Specific Settings",
            "item": "Joystick Swapper"
          }
        },
        {
          "label": "Paddle override",
          "kind": "menuOnly",
          "path": [
            "Joystick & controllers",
            "Paddle override"
          ]
        }
      ]
    },
    {
      "label": "LED lighting",
      "kind": "page",
      "path": [
        "LED lighting"
      ],
      "children": [
        {
          "label": "Power LED (if installed)",
          "kind": "section",
          "path": [
            "LED lighting",
            "Power LED (if installed)"
          ],
          "children": [
            {
              "label": "Output 1",
              "kind": "item",
              "path": [
                "LED lighting",
                "Power LED (if installed)",
                "Output 1"
              ],
              "rest": {
                "category": "U64 Specific Settings",
                "item": "LED Select Top"
              }
            },
            {
              "label": "Output 2",
              "kind": "item",
              "path": [
                "LED lighting",
                "Power LED (if installed)",
                "Output 2"
              ],
              "rest": {
                "category": "U64 Specific Settings",
                "item": "LED Select Bot"
              }
            }
          ]
        },
        {
          "label": "Case lights",
          "kind": "section",
          "path": [
            "LED lighting",
            "Case lights"
          ],
          "children": [
            {
              "label": "Mode",
              "kind": "item",
              "path": [
                "LED lighting",
                "Case lights",
                "Mode"
              ],
              "rest": {
                "category": "LED Strip Settings",
                "item": "LedStrip Mode"
              }
            },
            {
              "label": "Music detect",
              "kind": "item",
              "path": [
                "LED lighting",
                "Case lights",
                "Music detect"
              ],
              "rest": {
                "category": "LED Strip Settings",
                "item": "LedStrip Auto SID Mode"
              }
            },
            {
              "label": "Pattern",
              "kind": "item",
              "path": [
                "LED lighting",
                "Case lights",
                "Pattern"
              ],
              "rest": {
                "category": "LED Strip Settings",
                "item": "LedStrip Pattern"
              }
            },
            {
              "label": "Brightness",
              "kind": "item",
              "path": [
                "LED lighting",
                "Case lights",
                "Brightness"
              ],
              "rest": {
                "category": "LED Strip Settings",
                "item": "Strip Intensity"
              }
            },
            {
              "label": "Color",
              "kind": "item",
              "path": [
                "LED lighting",
                "Case lights",
                "Color"
              ],
              "rest": {
                "category": "LED Strip Settings",
                "item": "Fixed Color"
              }
            },
            {
              "label": "Tint",
              "kind": "item",
              "path": [
                "LED lighting",
                "Case lights",
                "Tint"
              ],
              "rest": {
                "category": "LED Strip Settings",
                "item": "Color tint"
              }
            }
          ]
        },
        {
          "label": "Keyboard lights",
          "kind": "section",
          "path": [
            "LED lighting",
            "Keyboard lights"
          ],
          "children": [
            {
              "label": "Mode",
              "kind": "item",
              "path": [
                "LED lighting",
                "Keyboard lights",
                "Mode"
              ],
              "rest": {
                "category": "Keyboard Lighting",
                "item": "LedStrip Mode"
              }
            },
            {
              "label": "Music detect",
              "kind": "item",
              "path": [
                "LED lighting",
                "Keyboard lights",
                "Music detect"
              ],
              "rest": {
                "category": "Keyboard Lighting",
                "item": "LedStrip Auto SID Mode"
              }
            },
            {
              "label": "Pattern",
              "kind": "item",
              "path": [
                "LED lighting",
                "Keyboard lights",
                "Pattern"
              ],
              "rest": {
                "category": "Keyboard Lighting",
                "item": "LedStrip Pattern"
              }
            },
            {
              "label": "Brightness",
              "kind": "item",
              "path": [
                "LED lighting",
                "Keyboard lights",
                "Brightness"
              ],
              "rest": {
                "category": "Keyboard Lighting",
                "item": "Strip Intensity"
              }
            },
            {
              "label": "Color",
              "kind": "item",
              "path": [
                "LED lighting",
                "Keyboard lights",
                "Color"
              ],
              "rest": {
                "category": "Keyboard Lighting",
                "item": "Fixed Color"
              }
            },
            {
              "label": "Tint",
              "kind": "item",
              "path": [
                "LED lighting",
                "Keyboard lights",
                "Tint"
              ],
              "rest": {
                "category": "Keyboard Lighting",
                "item": "Color tint"
              }
            }
          ]
        }
      ]
    },
    {
      "label": "Network services & timezone",
      "kind": "page",
      "path": [
        "Network services & timezone"
      ],
      "children": [
        {
          "label": "Host name",
          "kind": "item",
          "path": [
            "Network services & timezone",
            "Host name"
          ],
          "rest": {
            "category": "Network Settings",
            "item": "Host Name"
          }
        },
        {
          "label": "Unique ID",
          "kind": "item",
          "path": [
            "Network services & timezone",
            "Unique ID"
          ],
          "rest": {
            "category": "Network Settings",
            "item": "Unique ID"
          }
        },
        {
          "label": "Network password",
          "kind": "item",
          "path": [
            "Network services & timezone",
            "Network password"
          ],
          "rest": {
            "category": "Network Settings",
            "item": "Network Password"
          }
        },
        {
          "label": "Services",
          "kind": "section",
          "path": [
            "Network services & timezone",
            "Services"
          ],
          "children": [
            {
              "label": "Ultimate ident service",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Services",
                "Ultimate ident service"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Ultimate Ident Service"
              }
            },
            {
              "label": "Ultimate DMA service",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Services",
                "Ultimate DMA service"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Ultimate DMA Service"
              }
            },
            {
              "label": "Telnet remote menu service",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Services",
                "Telnet remote menu service"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Telnet Remote Menu Service"
              }
            },
            {
              "label": "FTP file service",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Services",
                "FTP file service"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "FTP File Service"
              }
            },
            {
              "label": "Web remote control service",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Services",
                "Web remote control service"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Web Remote Control Service"
              }
            },
            {
              "label": "Log to Syslog server",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Services",
                "Log to Syslog server"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Log to Syslog Server"
              }
            }
          ]
        },
        {
          "label": "Time synchronization",
          "kind": "section",
          "path": [
            "Network services & timezone",
            "Time synchronization"
          ],
          "children": [
            {
              "label": "SNTP enable",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Time synchronization",
                "SNTP enable"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "SNTP Enable"
              }
            },
            {
              "label": "Timezone",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Time synchronization",
                "Timezone"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "TimeZone"
              }
            },
            {
              "label": "Time server 1",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Time synchronization",
                "Time server 1"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Time Server 1"
              }
            },
            {
              "label": "Time server 2",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Time synchronization",
                "Time server 2"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Time Server 2"
              }
            },
            {
              "label": "Time server 3",
              "kind": "item",
              "path": [
                "Network services & timezone",
                "Time synchronization",
                "Time server 3"
              ],
              "rest": {
                "category": "Network Settings",
                "item": "Time Server 3"
              }
            }
          ]
        }
      ]
    },
    {
      "label": "Wired network setup",
      "kind": "page",
      "path": [
        "Wired network setup"
      ],
      "children": [
        {
          "label": "Use DHCP",
          "kind": "item",
          "path": [
            "Wired network setup",
            "Use DHCP"
          ],
          "rest": {
            "category": "Ethernet Settings",
            "item": "Use DHCP"
          }
        },
        {
          "label": "Static IP",
          "kind": "item",
          "path": [
            "Wired network setup",
            "Static IP"
          ],
          "rest": {
            "category": "Ethernet Settings",
            "item": "Static IP"
          }
        },
        {
          "label": "Static netmask",
          "kind": "item",
          "path": [
            "Wired network setup",
            "Static netmask"
          ],
          "rest": {
            "category": "Ethernet Settings",
            "item": "Static Netmask"
          }
        },
        {
          "label": "Static gateway",
          "kind": "item",
          "path": [
            "Wired network setup",
            "Static gateway"
          ],
          "rest": {
            "category": "Ethernet Settings",
            "item": "Static Gateway"
          }
        },
        {
          "label": "Static DNS",
          "kind": "item",
          "path": [
            "Wired network setup",
            "Static DNS"
          ],
          "rest": {
            "category": "Ethernet Settings",
            "item": "Static DNS"
          }
        },
        {
          "label": "Status",
          "kind": "section",
          "path": [
            "Wired network setup",
            "Status"
          ],
          "children": [
            {
              "label": "Status",
              "kind": "menuOnly",
              "path": [
                "Wired network setup",
                "Status",
                "Status"
              ]
            },
            {
              "label": "Active IP address",
              "kind": "menuOnly",
              "path": [
                "Wired network setup",
                "Status",
                "Active IP address"
              ]
            },
            {
              "label": "Interface MAC",
              "kind": "menuOnly",
              "path": [
                "Wired network setup",
                "Status",
                "Interface MAC"
              ]
            }
          ]
        }
      ]
    },
    {
      "label": "Wi-Fi network setup",
      "kind": "page",
      "path": [
        "Wi-Fi network setup"
      ],
      "children": [
        {
          "label": "Enable",
          "kind": "menuOnly",
          "path": [
            "Wi-Fi network setup",
            "Enable"
          ]
        },
        {
          "label": "Disable",
          "kind": "menuOnly",
          "path": [
            "Wi-Fi network setup",
            "Disable"
          ]
        },
        {
          "label": "Disconnect",
          "kind": "menuOnly",
          "path": [
            "Wi-Fi network setup",
            "Disconnect"
          ]
        },
        {
          "label": "Connect to last AP",
          "kind": "menuOnly",
          "path": [
            "Wi-Fi network setup",
            "Connect to last AP"
          ]
        },
        {
          "label": "Select AP from list",
          "kind": "menuOnly",
          "path": [
            "Wi-Fi network setup",
            "Select AP from list"
          ]
        },
        {
          "label": "Enter AP manually",
          "kind": "menuOnly",
          "path": [
            "Wi-Fi network setup",
            "Enter AP manually"
          ]
        },
        {
          "label": "Forget APs",
          "kind": "menuOnly",
          "path": [
            "Wi-Fi network setup",
            "Forget APs"
          ]
        },
        {
          "label": "Use DHCP",
          "kind": "item",
          "path": [
            "Wi-Fi network setup",
            "Use DHCP"
          ],
          "rest": {
            "category": "WiFi settings",
            "item": "Use DHCP"
          }
        },
        {
          "label": "Static IP",
          "kind": "item",
          "path": [
            "Wi-Fi network setup",
            "Static IP"
          ],
          "rest": {
            "category": "WiFi settings",
            "item": "Static IP"
          }
        },
        {
          "label": "Static netmask",
          "kind": "item",
          "path": [
            "Wi-Fi network setup",
            "Static netmask"
          ],
          "rest": {
            "category": "WiFi settings",
            "item": "Static Netmask"
          }
        },
        {
          "label": "Static gateway",
          "kind": "item",
          "path": [
            "Wi-Fi network setup",
            "Static gateway"
          ],
          "rest": {
            "category": "WiFi settings",
            "item": "Static Gateway"
          }
        },
        {
          "label": "Static DNS",
          "kind": "item",
          "path": [
            "Wi-Fi network setup",
            "Static DNS"
          ],
          "rest": {
            "category": "WiFi settings",
            "item": "Static DNS"
          }
        },
        {
          "label": "Status",
          "kind": "section",
          "path": [
            "Wi-Fi network setup",
            "Status"
          ],
          "children": [
            {
              "label": "Status",
              "kind": "menuOnly",
              "path": [
                "Wi-Fi network setup",
                "Status",
                "Status"
              ]
            },
            {
              "label": "Connected to",
              "kind": "menuOnly",
              "path": [
                "Wi-Fi network setup",
                "Status",
                "Connected to"
              ]
            },
            {
              "label": "Active IP address",
              "kind": "menuOnly",
              "path": [
                "Wi-Fi network setup",
                "Status",
                "Active IP address"
              ]
            },
            {
              "label": "Interface MAC",
              "kind": "menuOnly",
              "path": [
                "Wi-Fi network setup",
                "Status",
                "Interface MAC"
              ]
            }
          ]
        }
      ]
    },
    {
      "label": "Modems",
      "kind": "page",
      "path": [
        "Modems"
      ],
      "children": [
        {
          "label": "Modem interface",
          "kind": "item",
          "path": [
            "Modems",
            "Modem interface"
          ],
          "rest": {
            "category": "Modem Settings",
            "item": "Modem Interface"
          }
        },
        {
          "label": "ACIA (6551) mapping",
          "kind": "item",
          "path": [
            "Modems",
            "ACIA (6551) mapping"
          ],
          "rest": {
            "category": "Modem Settings",
            "item": "ACIA (6551) Mapping"
          }
        },
        {
          "label": "Hardware mode",
          "kind": "item",
          "path": [
            "Modems",
            "Hardware mode"
          ],
          "rest": {
            "category": "Modem Settings",
            "item": "Hardware Mode"
          }
        },
        {
          "label": "Listening port",
          "kind": "item",
          "path": [
            "Modems",
            "Listening port"
          ],
          "rest": {
            "category": "Modem Settings",
            "item": "Listening Port"
          }
        },
        {
          "label": "Handshaking",
          "kind": "section",
          "path": [
            "Modems",
            "Handshaking"
          ],
          "children": [
            {
              "label": "Do RING sequence (incoming)",
              "kind": "item",
              "path": [
                "Modems",
                "Handshaking",
                "Do RING sequence (incoming)"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Do RING sequence (incoming)"
              }
            },
            {
              "label": "Drop connection on DTR low",
              "kind": "item",
              "path": [
                "Modems",
                "Handshaking",
                "Drop connection on DTR low"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Drop connection on DTR low"
              }
            },
            {
              "label": "RTS handshake (Rx)",
              "kind": "item",
              "path": [
                "Modems",
                "Handshaking",
                "RTS handshake (Rx)"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "RTS Handshake (Rx)"
              }
            },
            {
              "label": "CTS behavior",
              "kind": "item",
              "path": [
                "Modems",
                "Handshaking",
                "CTS behavior"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "CTS Behavior"
              }
            },
            {
              "label": "DCD behavior",
              "kind": "item",
              "path": [
                "Modems",
                "Handshaking",
                "DCD behavior"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "DCD Behavior"
              }
            },
            {
              "label": "DSR behavior",
              "kind": "item",
              "path": [
                "Modems",
                "Handshaking",
                "DSR behavior"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "DSR Behavior"
              }
            },
            {
              "label": "Automatic Rx pushback",
              "kind": "item",
              "path": [
                "Modems",
                "Handshaking",
                "Automatic Rx pushback"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Automatic Rx Pushback"
              }
            }
          ]
        },
        {
          "label": "Automated responses",
          "kind": "section",
          "path": [
            "Modems",
            "Automated responses"
          ],
          "children": [
            {
              "label": "Modem offline text",
              "kind": "item",
              "path": [
                "Modems",
                "Automated responses",
                "Modem offline text"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Modem Offline Text"
              }
            },
            {
              "label": "Modem connect text",
              "kind": "item",
              "path": [
                "Modems",
                "Automated responses",
                "Modem connect text"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Modem Connect Text"
              }
            },
            {
              "label": "Modem busy text",
              "kind": "item",
              "path": [
                "Modems",
                "Automated responses",
                "Modem busy text"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Modem Busy Text"
              }
            }
          ]
        },
        {
          "label": "Tweaks",
          "kind": "section",
          "path": [
            "Modems",
            "Tweaks"
          ],
          "children": [
            {
              "label": "Set socket opt TCP_NODELAY",
              "kind": "item",
              "path": [
                "Modems",
                "Tweaks",
                "Set socket opt TCP_NODELAY"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Set Socket Opt TCP_NODELAY"
              }
            },
            {
              "label": "Loop delay",
              "kind": "item",
              "path": [
                "Modems",
                "Tweaks",
                "Loop delay"
              ],
              "rest": {
                "category": "Modem Settings",
                "item": "Loop Delay"
              }
            }
          ]
        }
      ]
    },
    {
      "label": "Printers",
      "kind": "page",
      "path": [
        "Printers"
      ],
      "children": [
        {
          "label": "IEC printer",
          "kind": "item",
          "path": [
            "Printers",
            "IEC printer"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "IEC printer"
          }
        },
        {
          "label": "Bus ID",
          "kind": "item",
          "path": [
            "Printers",
            "Bus ID"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Bus ID"
          }
        },
        {
          "label": "Output file",
          "kind": "item",
          "path": [
            "Printers",
            "Output file"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Output file"
          }
        },
        {
          "label": "Output type",
          "kind": "item",
          "path": [
            "Printers",
            "Output type"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Output type"
          }
        },
        {
          "label": "Ink density",
          "kind": "item",
          "path": [
            "Printers",
            "Ink density"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Ink density"
          }
        },
        {
          "label": "Page top margin (default is 5)",
          "kind": "item",
          "path": [
            "Printers",
            "Page top margin (default is 5)"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Page top margin (default is 5)"
          }
        },
        {
          "label": "Page height (default is 60)",
          "kind": "item",
          "path": [
            "Printers",
            "Page height (default is 60)"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Page height (default is 60)"
          }
        },
        {
          "label": "Emulation",
          "kind": "item",
          "path": [
            "Printers",
            "Emulation"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Emulation"
          }
        },
        {
          "label": "Commodore charset",
          "kind": "item",
          "path": [
            "Printers",
            "Commodore charset"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Commodore charset"
          }
        },
        {
          "label": "Epson charset",
          "kind": "item",
          "path": [
            "Printers",
            "Epson charset"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "Epson charset"
          }
        },
        {
          "label": "IBM table 2",
          "kind": "item",
          "path": [
            "Printers",
            "IBM table 2"
          ],
          "rest": {
            "category": "Printer Settings",
            "item": "IBM table 2"
          }
        }
      ]
    },
    {
      "label": "User interface",
      "kind": "page",
      "path": [
        "User interface"
      ],
      "children": [
        {
          "label": "Interface type",
          "kind": "item",
          "path": [
            "User interface",
            "Interface type"
          ],
          "rest": {
            "category": "User Interface Settings",
            "item": "Interface Type"
          }
        },
        {
          "label": "Navigation style",
          "kind": "item",
          "path": [
            "User interface",
            "Navigation style"
          ],
          "rest": {
            "category": "User Interface Settings",
            "item": "Navigation Style"
          }
        },
        {
          "label": "Color scheme",
          "kind": "item",
          "path": [
            "User interface",
            "Color scheme"
          ],
          "rest": {
            "category": "User Interface Settings",
            "item": "Color Scheme"
          }
        },
        {
          "label": "Auto save config",
          "kind": "item",
          "path": [
            "User interface",
            "Auto save config"
          ],
          "rest": {
            "category": "User Interface Settings",
            "item": "Auto Save Config"
          }
        },
        {
          "label": "Ulticopy uses disk name",
          "kind": "item",
          "path": [
            "User interface",
            "Ulticopy uses disk name"
          ],
          "rest": {
            "category": "User Interface Settings",
            "item": "Ulticopy Uses disk name"
          }
        },
        {
          "label": "Filename overflow squeeze",
          "kind": "item",
          "path": [
            "User interface",
            "Filename overflow squeeze"
          ],
          "rest": {
            "category": "User Interface Settings",
            "item": "Filename overflow squeeze"
          }
        }
      ]
    },
    {
      "label": "Built-in drive A",
      "kind": "page",
      "path": [
        "Built-in drive A"
      ],
      "children": [
        {
          "label": "Drive",
          "kind": "item",
          "path": [
            "Built-in drive A",
            "Drive"
          ],
          "rest": {
            "category": "Drive A Settings",
            "item": "Drive"
          }
        },
        {
          "label": "Drive type",
          "kind": "item",
          "path": [
            "Built-in drive A",
            "Drive type"
          ],
          "rest": {
            "category": "Drive A Settings",
            "item": "Drive Type"
          }
        },
        {
          "label": "Drive bus ID",
          "kind": "item",
          "path": [
            "Built-in drive A",
            "Drive bus ID"
          ],
          "rest": {
            "category": "Drive A Settings",
            "item": "Drive Bus ID"
          }
        },
        {
          "label": "ROMs",
          "kind": "section",
          "path": [
            "Built-in drive A",
            "ROMs"
          ],
          "children": [
            {
              "label": "ROM for 1541 mode",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "ROMs",
                "ROM for 1541 mode"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "ROM for 1541 mode"
              }
            },
            {
              "label": "ROM for 1571 mode",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "ROMs",
                "ROM for 1571 mode"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "ROM for 1571 mode"
              }
            },
            {
              "label": "ROM for 1581 mode",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "ROMs",
                "ROM for 1581 mode"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "ROM for 1581 mode"
              }
            }
          ]
        },
        {
          "label": "Advanced",
          "kind": "section",
          "path": [
            "Built-in drive A",
            "Advanced"
          ],
          "children": [
            {
              "label": "Extra RAM",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "Advanced",
                "Extra RAM"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "Extra RAM"
              }
            },
            {
              "label": "Disk swap delay",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "Advanced",
                "Disk swap delay"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "Disk swap delay"
              }
            },
            {
              "label": "Resets when C64 resets",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "Advanced",
                "Resets when C64 resets"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "Resets when C64 resets"
              }
            },
            {
              "label": "Freezes in menu",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "Advanced",
                "Freezes in menu"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "Freezes in menu"
              }
            },
            {
              "label": "GCR save align tracks",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "Advanced",
                "GCR save align tracks"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "GCR Save Align Tracks"
              }
            },
            {
              "label": "Leave menu on mount",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "Advanced",
                "Leave menu on mount"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "Leave Menu on Mount"
              }
            },
            {
              "label": "D64 GEOS copy protection",
              "kind": "item",
              "path": [
                "Built-in drive A",
                "Advanced",
                "D64 GEOS copy protection"
              ],
              "rest": {
                "category": "Drive A Settings",
                "item": "D64 Geos Copy Protection"
              }
            }
          ]
        }
      ]
    },
    {
      "label": "Built-in drive B",
      "kind": "page",
      "path": [
        "Built-in drive B"
      ],
      "children": [
        {
          "label": "Drive",
          "kind": "item",
          "path": [
            "Built-in drive B",
            "Drive"
          ],
          "rest": {
            "category": "Drive B Settings",
            "item": "Drive"
          }
        },
        {
          "label": "Drive type",
          "kind": "item",
          "path": [
            "Built-in drive B",
            "Drive type"
          ],
          "rest": {
            "category": "Drive B Settings",
            "item": "Drive Type"
          }
        },
        {
          "label": "Drive bus ID",
          "kind": "item",
          "path": [
            "Built-in drive B",
            "Drive bus ID"
          ],
          "rest": {
            "category": "Drive B Settings",
            "item": "Drive Bus ID"
          }
        },
        {
          "label": "ROMs",
          "kind": "section",
          "path": [
            "Built-in drive B",
            "ROMs"
          ],
          "children": [
            {
              "label": "ROM for 1541 mode",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "ROMs",
                "ROM for 1541 mode"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "ROM for 1541 mode"
              }
            },
            {
              "label": "ROM for 1571 mode",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "ROMs",
                "ROM for 1571 mode"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "ROM for 1571 mode"
              }
            },
            {
              "label": "ROM for 1581 mode",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "ROMs",
                "ROM for 1581 mode"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "ROM for 1581 mode"
              }
            }
          ]
        },
        {
          "label": "Advanced",
          "kind": "section",
          "path": [
            "Built-in drive B",
            "Advanced"
          ],
          "children": [
            {
              "label": "Extra RAM",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "Advanced",
                "Extra RAM"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "Extra RAM"
              }
            },
            {
              "label": "Disk swap delay",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "Advanced",
                "Disk swap delay"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "Disk swap delay"
              }
            },
            {
              "label": "Resets when C64 resets",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "Advanced",
                "Resets when C64 resets"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "Resets when C64 resets"
              }
            },
            {
              "label": "Freezes in menu",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "Advanced",
                "Freezes in menu"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "Freezes in menu"
              }
            },
            {
              "label": "GCR save align tracks",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "Advanced",
                "GCR save align tracks"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "GCR Save Align Tracks"
              }
            },
            {
              "label": "Leave menu on mount",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "Advanced",
                "Leave menu on mount"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "Leave Menu on Mount"
              }
            },
            {
              "label": "D64 GEOS copy protection",
              "kind": "item",
              "path": [
                "Built-in drive B",
                "Advanced",
                "D64 GEOS copy protection"
              ],
              "rest": {
                "category": "Drive B Settings",
                "item": "D64 Geos Copy Protection"
              }
            }
          ]
        }
      ]
    }
  ],
  "restCategories": [
    "Audio Mixer",
    "C64 and Cartridge Settings",
    "Drive A Settings",
    "Drive B Settings",
    "Ethernet Settings",
    "Keyboard Lighting",
    "LED Strip Settings",
    "Modem Settings",
    "Network Settings",
    "Printer Settings",
    "SID Addressing",
    "SID Sockets Configuration",
    "Speaker Mixer",
    "U64 Specific Settings",
    "UltiSID Configuration",
    "User Interface Settings",
    "WiFi settings"
  ],
  "claimedItemsByCategory": {
    "C64 and Cartridge Settings": [
      "Kernal ROM",
      "Basic ROM",
      "Char ROM",
      "Cartridge",
      "RAM Expansion Unit",
      "REU Size",
      "Command Interface",
      "Map Ultimate Audio $DF20-DFFF"
    ],
    "Drive A Settings": [
      "ROM for 1541 mode",
      "ROM for 1571 mode",
      "ROM for 1581 mode",
      "Drive",
      "Drive Type",
      "Drive Bus ID",
      "Extra RAM",
      "Disk swap delay",
      "Resets when C64 resets",
      "Freezes in menu",
      "GCR Save Align Tracks",
      "Leave Menu on Mount",
      "D64 Geos Copy Protection"
    ],
    "Drive B Settings": [
      "ROM for 1541 mode",
      "ROM for 1571 mode",
      "ROM for 1581 mode",
      "Drive",
      "Drive Type",
      "Drive Bus ID",
      "Extra RAM",
      "Disk swap delay",
      "Resets when C64 resets",
      "Freezes in menu",
      "GCR Save Align Tracks",
      "Leave Menu on Mount",
      "D64 Geos Copy Protection"
    ],
    "U64 Specific Settings": [
      "Turbo Control",
      "CPU Speed",
      "Badline Timing",
      "SuperCPU Detect (D0BC)",
      "System Mode",
      "HDMI Scan Resolution",
      "HDMI Scan lines",
      "Palette Definition",
      "Analog Video Mode",
      "Digital Video Mode",
      "SID Player Autoconfig",
      "Allow Autoconfig uses UltiSid",
      "Joystick Swapper",
      "LED Select Top",
      "LED Select Bot"
    ],
    "Audio Mixer": [
      "Vol UltiSid 1",
      "Vol UltiSid 2",
      "Vol Socket 1",
      "Vol Socket 2",
      "Vol Sampler L",
      "Vol Sampler R",
      "Vol Drive 1",
      "Vol Drive 2",
      "Vol Tape Read",
      "Vol Tape Write",
      "Pan UltiSID 1",
      "Pan UltiSID 2",
      "Pan Socket 1",
      "Pan Socket 2",
      "Pan Sampler L",
      "Pan Sampler R",
      "Pan Drive 1",
      "Pan Drive 2",
      "Pan Tape Read",
      "Pan Tape Write"
    ],
    "Speaker Mixer": [
      "Speaker Enable",
      "Vol UltiSid 1",
      "Vol UltiSid 2",
      "Vol Socket 1",
      "Vol Socket 2",
      "Vol Sampler L",
      "Vol Sampler R",
      "Vol Drive 1",
      "Vol Drive 2",
      "Vol Tape Read",
      "Vol Tape Write"
    ],
    "SID Sockets Configuration": [
      "SID Socket 1",
      "SID Socket 2",
      "SID Detected Socket 1",
      "SID Detected Socket 2",
      "SID Socket 1 1K Ohm Resistor",
      "SID Socket 2 1K Ohm Resistor",
      "SID Socket 1 Capacitors",
      "SID Socket 2 Capacitors"
    ],
    "UltiSID Configuration": [
      "UltiSID 1 Filter Curve",
      "UltiSID 2 Filter Curve",
      "UltiSID 1 Filter Resonance",
      "UltiSID 2 Filter Resonance",
      "UltiSID 1 Combined Waveforms",
      "UltiSID 2 Combined Waveforms",
      "UltiSID 1 Digis Level",
      "UltiSID 2 Digis Level"
    ],
    "SID Addressing": [
      "SID Socket 1 Address",
      "SID Socket 2 Address",
      "Ext DualSID Range Split",
      "UltiSID 1 Address",
      "UltiSID 2 Address",
      "UltiSID Range Split",
      "Paddle Override",
      "Auto Address Mirroring"
    ],
    "LED Strip Settings": [
      "LedStrip Mode",
      "LedStrip Auto SID Mode",
      "LedStrip Pattern",
      "Strip Intensity",
      "Fixed Color",
      "Color tint"
    ],
    "Keyboard Lighting": [
      "LedStrip Mode",
      "LedStrip Auto SID Mode",
      "LedStrip Pattern",
      "Strip Intensity",
      "Fixed Color",
      "Color tint"
    ],
    "Network Settings": [
      "Host Name",
      "Unique ID",
      "Network Password",
      "Ultimate Ident Service",
      "Ultimate DMA Service",
      "Telnet Remote Menu Service",
      "FTP File Service",
      "Web Remote Control Service",
      "Log to Syslog Server",
      "SNTP Enable",
      "TimeZone",
      "Time Server 1",
      "Time Server 2",
      "Time Server 3"
    ],
    "Ethernet Settings": [
      "Use DHCP",
      "Static IP",
      "Static Netmask",
      "Static Gateway",
      "Static DNS"
    ],
    "WiFi settings": [
      "Use DHCP",
      "Static IP",
      "Static Netmask",
      "Static Gateway",
      "Static DNS"
    ],
    "Modem Settings": [
      "Modem Interface",
      "ACIA (6551) Mapping",
      "Hardware Mode",
      "Listening Port",
      "Do RING sequence (incoming)",
      "Drop connection on DTR low",
      "RTS Handshake (Rx)",
      "CTS Behavior",
      "DCD Behavior",
      "DSR Behavior",
      "Automatic Rx Pushback",
      "Modem Offline Text",
      "Modem Connect Text",
      "Modem Busy Text",
      "Set Socket Opt TCP_NODELAY",
      "Loop Delay"
    ],
    "Printer Settings": [
      "IEC printer",
      "Bus ID",
      "Output file",
      "Output type",
      "Ink density",
      "Page top margin (default is 5)",
      "Page height (default is 60)",
      "Emulation",
      "Commodore charset",
      "Epson charset",
      "IBM table 2"
    ],
    "User Interface Settings": [
      "Interface Type",
      "Navigation Style",
      "Color Scheme",
      "Auto Save Config",
      "Ulticopy Uses disk name",
      "Filename overflow squeeze"
    ]
  }
};

/** Layer A — device-agnostic terminology overlay derived from the C64U menu. */
export const C64U_1_1_0_OVERLAY: TerminologyOverlay = {
  "C64 and Cartridge Settings": {
    "Kernal ROM": {
      "label": "Kernal ROM"
    },
    "Basic ROM": {
      "label": "BASIC ROM"
    },
    "Char ROM": {
      "label": "Character ROM"
    },
    "Cartridge": {
      "label": "Cartridge"
    },
    "RAM Expansion Unit": {
      "label": "RAM expansion unit"
    },
    "REU Size": {
      "label": "Size"
    },
    "Command Interface": {
      "label": "Command interface"
    },
    "Map Ultimate Audio $DF20-DFFF": {
      "label": "Ultimate audio"
    }
  },
  "U64 Specific Settings": {
    "Turbo Control": {
      "label": "Turbo control"
    },
    "CPU Speed": {
      "label": "CPU speed",
      "formatterId": "cpuSpeedMhz"
    },
    "Badline Timing": {
      "label": "Badline timing"
    },
    "SuperCPU Detect (D0BC)": {
      "label": "SuperCPU detect (D0BC)"
    },
    "System Mode": {
      "label": "System mode"
    },
    "HDMI Scan Resolution": {
      "label": "HDMI scan resolution"
    },
    "HDMI Scan lines": {
      "label": "HDMI scan lines"
    },
    "Palette Definition": {
      "label": "Palette definition"
    },
    "Analog Video Mode": {
      "label": "Analog video mode"
    },
    "Digital Video Mode": {
      "label": "Digital video mode"
    },
    "SID Player Autoconfig": {
      "label": "SID player autoconfig"
    },
    "Allow Autoconfig uses UltiSid": {
      "label": "Allow autoconfig uses UltiSID"
    },
    "Joystick Swapper": {
      "label": "Joystick input"
    },
    "LED Select Top": {
      "label": "Output 1"
    },
    "LED Select Bot": {
      "label": "Output 2"
    }
  },
  "Audio Mixer": {
    "Vol UltiSid 1": {
      "label": "Vol UltiSID 1",
      "formatterId": "db"
    },
    "Vol UltiSid 2": {
      "label": "Vol UltiSID 2",
      "formatterId": "db"
    },
    "Vol Socket 1": {
      "label": "Vol socket 1",
      "formatterId": "db"
    },
    "Vol Socket 2": {
      "label": "Vol socket 2",
      "formatterId": "db"
    },
    "Vol Sampler L": {
      "label": "Vol sampler L",
      "formatterId": "db"
    },
    "Vol Sampler R": {
      "label": "Vol sampler R",
      "formatterId": "db"
    },
    "Vol Drive 1": {
      "label": "Vol drive 1",
      "formatterId": "db"
    },
    "Vol Drive 2": {
      "label": "Vol drive 2",
      "formatterId": "db"
    },
    "Vol Tape Read": {
      "label": "Vol tape read",
      "formatterId": "db"
    },
    "Vol Tape Write": {
      "label": "Vol tape write",
      "formatterId": "db"
    },
    "Pan UltiSID 1": {
      "label": "Pan UltiSID 1",
      "formatterId": "pan"
    },
    "Pan UltiSID 2": {
      "label": "Pan UltiSID 2",
      "formatterId": "pan"
    },
    "Pan Socket 1": {
      "label": "Pan socket 1",
      "formatterId": "pan"
    },
    "Pan Socket 2": {
      "label": "Pan socket 2",
      "formatterId": "pan"
    },
    "Pan Sampler L": {
      "label": "Pan sampler L",
      "formatterId": "pan"
    },
    "Pan Sampler R": {
      "label": "Pan sampler R",
      "formatterId": "pan"
    },
    "Pan Drive 1": {
      "label": "Pan drive 1",
      "formatterId": "pan"
    },
    "Pan Drive 2": {
      "label": "Pan drive 2",
      "formatterId": "pan"
    },
    "Pan Tape Read": {
      "label": "Pan tape read",
      "formatterId": "pan"
    },
    "Pan Tape Write": {
      "label": "Pan tape write",
      "formatterId": "pan"
    }
  },
  "Speaker Mixer": {
    "Speaker Enable": {
      "label": "Speaker enable"
    },
    "Vol UltiSid 1": {
      "label": "Vol UltiSID 1",
      "formatterId": "db"
    },
    "Vol UltiSid 2": {
      "label": "Vol UltiSID 2",
      "formatterId": "db"
    },
    "Vol Socket 1": {
      "label": "Vol socket 1",
      "formatterId": "db"
    },
    "Vol Socket 2": {
      "label": "Vol socket 2",
      "formatterId": "db"
    },
    "Vol Sampler L": {
      "label": "Vol sampler L",
      "formatterId": "db"
    },
    "Vol Sampler R": {
      "label": "Vol sampler R",
      "formatterId": "db"
    },
    "Vol Drive 1": {
      "label": "Vol drive 1",
      "formatterId": "db"
    },
    "Vol Drive 2": {
      "label": "Vol drive 2",
      "formatterId": "db"
    },
    "Vol Tape Read": {
      "label": "Vol tape read",
      "formatterId": "db"
    },
    "Vol Tape Write": {
      "label": "Vol tape write",
      "formatterId": "db"
    }
  },
  "SID Sockets Configuration": {
    "SID Socket 1": {
      "label": "SID socket 1"
    },
    "SID Socket 2": {
      "label": "SID socket 2"
    },
    "SID Detected Socket 1": {
      "label": "SID detected socket 1"
    },
    "SID Detected Socket 2": {
      "label": "SID detected socket 2"
    },
    "SID Socket 1 1K Ohm Resistor": {
      "label": "SID socket 1 1K ohm resistor"
    },
    "SID Socket 2 1K Ohm Resistor": {
      "label": "SID socket 2 1K ohm resistor"
    },
    "SID Socket 1 Capacitors": {
      "label": "SID socket 1 capacitors"
    },
    "SID Socket 2 Capacitors": {
      "label": "SID socket 2 capacitors"
    }
  },
  "UltiSID Configuration": {
    "UltiSID 1 Filter Curve": {
      "label": "UltiSID 1 filter curve"
    },
    "UltiSID 2 Filter Curve": {
      "label": "UltiSID 2 filter curve"
    },
    "UltiSID 1 Filter Resonance": {
      "label": "UltiSID 1 filter resonance"
    },
    "UltiSID 2 Filter Resonance": {
      "label": "UltiSID 2 filter resonance"
    },
    "UltiSID 1 Combined Waveforms": {
      "label": "UltiSID 1 combined waveforms"
    },
    "UltiSID 2 Combined Waveforms": {
      "label": "UltiSID 2 combined waveforms"
    },
    "UltiSID 1 Digis Level": {
      "label": "UltiSID 1 digis level"
    },
    "UltiSID 2 Digis Level": {
      "label": "UltiSID 2 digis level"
    }
  },
  "SID Addressing": {
    "SID Socket 1 Address": {
      "label": "SID socket 1 address",
      "formatterId": "address"
    },
    "SID Socket 2 Address": {
      "label": "SID socket 2 address",
      "formatterId": "address"
    },
    "Ext DualSID Range Split": {
      "label": "Ext DualSID range split"
    },
    "UltiSID 1 Address": {
      "label": "UltiSID 1 address",
      "formatterId": "address"
    },
    "UltiSID 2 Address": {
      "label": "UltiSID 2 address",
      "formatterId": "address"
    },
    "UltiSID Range Split": {
      "label": "UltiSID range split"
    },
    "Paddle Override": {
      "label": "Paddle override"
    },
    "Auto Address Mirroring": {
      "label": "Auto addr mirroring"
    }
  },
  "LED Strip Settings": {
    "LedStrip Mode": {
      "label": "Mode"
    },
    "LedStrip Auto SID Mode": {
      "label": "Music detect"
    },
    "LedStrip Pattern": {
      "label": "Pattern"
    },
    "Strip Intensity": {
      "label": "Brightness"
    },
    "Fixed Color": {
      "label": "Color"
    },
    "Color tint": {
      "label": "Tint"
    }
  },
  "Keyboard Lighting": {
    "LedStrip Mode": {
      "label": "Mode"
    },
    "LedStrip Auto SID Mode": {
      "label": "Music detect"
    },
    "LedStrip Pattern": {
      "label": "Pattern"
    },
    "Strip Intensity": {
      "label": "Brightness"
    },
    "Fixed Color": {
      "label": "Color"
    },
    "Color tint": {
      "label": "Tint"
    }
  },
  "Network Settings": {
    "Host Name": {
      "label": "Host name"
    },
    "Unique ID": {
      "label": "Unique ID"
    },
    "Network Password": {
      "label": "Network password"
    },
    "Ultimate Ident Service": {
      "label": "Ultimate ident service"
    },
    "Ultimate DMA Service": {
      "label": "Ultimate DMA service"
    },
    "Telnet Remote Menu Service": {
      "label": "Telnet remote menu service"
    },
    "FTP File Service": {
      "label": "FTP file service"
    },
    "Web Remote Control Service": {
      "label": "Web remote control service"
    },
    "Log to Syslog Server": {
      "label": "Log to Syslog server"
    },
    "SNTP Enable": {
      "label": "SNTP enable"
    },
    "TimeZone": {
      "label": "Timezone"
    },
    "Time Server 1": {
      "label": "Time server 1"
    },
    "Time Server 2": {
      "label": "Time server 2"
    },
    "Time Server 3": {
      "label": "Time server 3"
    }
  },
  "Ethernet Settings": {
    "Use DHCP": {
      "label": "Use DHCP"
    },
    "Static IP": {
      "label": "Static IP"
    },
    "Static Netmask": {
      "label": "Static netmask"
    },
    "Static Gateway": {
      "label": "Static gateway"
    },
    "Static DNS": {
      "label": "Static DNS"
    }
  },
  "WiFi settings": {
    "Use DHCP": {
      "label": "Use DHCP"
    },
    "Static IP": {
      "label": "Static IP"
    },
    "Static Netmask": {
      "label": "Static netmask"
    },
    "Static Gateway": {
      "label": "Static gateway"
    },
    "Static DNS": {
      "label": "Static DNS"
    }
  },
  "Modem Settings": {
    "Modem Interface": {
      "label": "Modem interface"
    },
    "ACIA (6551) Mapping": {
      "label": "ACIA (6551) mapping"
    },
    "Hardware Mode": {
      "label": "Hardware mode"
    },
    "Listening Port": {
      "label": "Listening port"
    },
    "Do RING sequence (incoming)": {
      "label": "Do RING sequence (incoming)"
    },
    "Drop connection on DTR low": {
      "label": "Drop connection on DTR low"
    },
    "RTS Handshake (Rx)": {
      "label": "RTS handshake (Rx)"
    },
    "CTS Behavior": {
      "label": "CTS behavior"
    },
    "DCD Behavior": {
      "label": "DCD behavior"
    },
    "DSR Behavior": {
      "label": "DSR behavior"
    },
    "Automatic Rx Pushback": {
      "label": "Automatic Rx pushback"
    },
    "Modem Offline Text": {
      "label": "Modem offline text"
    },
    "Modem Connect Text": {
      "label": "Modem connect text"
    },
    "Modem Busy Text": {
      "label": "Modem busy text"
    },
    "Set Socket Opt TCP_NODELAY": {
      "label": "Set socket opt TCP_NODELAY"
    },
    "Loop Delay": {
      "label": "Loop delay"
    }
  },
  "Printer Settings": {
    "IEC printer": {
      "label": "IEC printer"
    },
    "Bus ID": {
      "label": "Bus ID"
    },
    "Output file": {
      "label": "Output file"
    },
    "Output type": {
      "label": "Output type"
    },
    "Ink density": {
      "label": "Ink density"
    },
    "Page top margin (default is 5)": {
      "label": "Page top margin (default is 5)"
    },
    "Page height (default is 60)": {
      "label": "Page height (default is 60)"
    },
    "Emulation": {
      "label": "Emulation"
    },
    "Commodore charset": {
      "label": "Commodore charset"
    },
    "Epson charset": {
      "label": "Epson charset"
    },
    "IBM table 2": {
      "label": "IBM table 2"
    }
  },
  "User Interface Settings": {
    "Interface Type": {
      "label": "Interface type"
    },
    "Navigation Style": {
      "label": "Navigation style"
    },
    "Color Scheme": {
      "label": "Color scheme"
    },
    "Auto Save Config": {
      "label": "Auto save config"
    },
    "Ulticopy Uses disk name": {
      "label": "Ulticopy uses disk name"
    },
    "Filename overflow squeeze": {
      "label": "Filename overflow squeeze"
    }
  },
  "Drive A Settings": {
    "Drive": {
      "label": "Drive"
    },
    "Drive Type": {
      "label": "Drive type"
    },
    "Drive Bus ID": {
      "label": "Drive bus ID"
    },
    "ROM for 1541 mode": {
      "label": "ROM for 1541 mode"
    },
    "ROM for 1571 mode": {
      "label": "ROM for 1571 mode"
    },
    "ROM for 1581 mode": {
      "label": "ROM for 1581 mode"
    },
    "Extra RAM": {
      "label": "Extra RAM"
    },
    "Disk swap delay": {
      "label": "Disk swap delay"
    },
    "Resets when C64 resets": {
      "label": "Resets when C64 resets"
    },
    "Freezes in menu": {
      "label": "Freezes in menu"
    },
    "GCR Save Align Tracks": {
      "label": "GCR save align tracks"
    },
    "Leave Menu on Mount": {
      "label": "Leave menu on mount"
    },
    "D64 Geos Copy Protection": {
      "label": "D64 GEOS copy protection"
    }
  },
  "Drive B Settings": {
    "Drive": {
      "label": "Drive"
    },
    "Drive Type": {
      "label": "Drive type"
    },
    "Drive Bus ID": {
      "label": "Drive bus ID"
    },
    "ROM for 1541 mode": {
      "label": "ROM for 1541 mode"
    },
    "ROM for 1571 mode": {
      "label": "ROM for 1571 mode"
    },
    "ROM for 1581 mode": {
      "label": "ROM for 1581 mode"
    },
    "Extra RAM": {
      "label": "Extra RAM"
    },
    "Disk swap delay": {
      "label": "Disk swap delay"
    },
    "Resets when C64 resets": {
      "label": "Resets when C64 resets"
    },
    "Freezes in menu": {
      "label": "Freezes in menu"
    },
    "GCR Save Align Tracks": {
      "label": "GCR save align tracks"
    },
    "Leave Menu on Mount": {
      "label": "Leave menu on mount"
    },
    "D64 Geos Copy Protection": {
      "label": "D64 GEOS copy protection"
    }
  }
};
