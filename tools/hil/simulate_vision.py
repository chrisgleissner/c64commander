#!/usr/bin/env python3
"""
Render a device screenshot the way the target user actually sees it.

The Callback 8020's panel is 3.25 inches diagonal at 480x640, so at a normal 14-inch viewing
distance it subtends about 8 by 10.7 degrees — roughly the size of a credit card held at arm's
length. A screenshot inspected full-size on a 27-inch monitor tells you almost nothing about
whether that panel is readable.

This applies, in order:
  1. the angular size the panel actually occupies,
  2. a blur standing in for the acuity a 50-60 year old reader has (presbyopia plus normal
     age-related loss, around 20/30 rather than 20/20),
  3. reduced contrast, which is the part of vision that degrades first with age,
  4. reduced luminance, standing in for a dim room.

Usage: simulate_vision.py <in.png> <out.png> [--acuity 20/30] [--light dim|normal]
"""

import sys
from PIL import Image, ImageFilter, ImageEnhance

ACUITY_BLUR = {"20/20": 0.0, "20/30": 1.1, "20/40": 1.8, "20/60": 3.0}
LIGHT = {"normal": (1.0, 1.0), "dim": (0.70, 0.62)}  # (contrast, brightness)


def simulate(path_in: str, path_out: str, acuity: str = "20/30", light: str = "dim") -> None:
    image = Image.open(path_in).convert("RGB")
    # The panel is 480x640 native. Present it at the angular size it really occupies rather than
    # at monitor size: a 2.4x reduction approximates a 3.25in panel at 14in against a 27in monitor
    # at the same distance.
    angular = image.resize((round(image.width / 2.4), round(image.height / 2.4)), Image.LANCZOS)
    blurred = angular.filter(ImageFilter.GaussianBlur(ACUITY_BLUR.get(acuity, 1.1)))
    contrast, brightness = LIGHT.get(light, LIGHT["dim"])
    seen = ImageEnhance.Brightness(ImageEnhance.Contrast(blurred).enhance(contrast)).enhance(brightness)
    # Scaled back up so the result can be inspected, without recovering any detail the eye lost.
    seen.resize(image.size, Image.NEAREST).save(path_out)


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        raise SystemExit(__doc__)
    acuity = args[args.index("--acuity") + 1] if "--acuity" in args else "20/30"
    light = args[args.index("--light") + 1] if "--light" in args else "dim"
    simulate(args[0], args[1], acuity, light)
