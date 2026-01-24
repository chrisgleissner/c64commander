#!/usr/bin/env python3
"""Deprecated wrapper for play_first_disk_prg.py."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from play_first_disk_prg import main


if __name__ == "__main__":
    main()
