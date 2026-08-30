#!/usr/bin/env bash
# Installs the toolchain that typesets the manual, if it is not already there.
#
# One list, two callers: `./build --manual` runs this before building, and so
# does the manual workflow in CI. Keeping the list in one file is what stops a
# green CI run from meaning nothing about whether a contributor can build the
# book on their own machine.
#
# Deliberately not texlive-full. That is about 6 GB and takes minutes to fetch
# on a hosted runner. The manual needs five TeX Live packages and pandoc, which
# come to roughly 380 MB: the fonts are vendored in this repository, so none of
# the TeX font packages are needed at all.
#
# Ubuntu and Debian only. On anything else, install the equivalents by hand; the
# list below is short and the package names are conventional.
set -euo pipefail

PACKAGES=(
  texlive-latex-base         # lualatex itself, plus graphicx, longtable, array, colortbl, hyperref
  texlive-latex-recommended  # memoir, microtype, xcolor, caption, booktabs, eso-pic, fontspec, ragged2e
  texlive-latex-extra        # tcolorbox, imakeidx, enumitem
  texlive-luatex             # luaotfload, without which lualatex cannot load an OpenType face
  texlive-binaries           # makeindex
  pandoc                     # markdown to LaTeX
)

have_everything() {
  command -v lualatex >/dev/null 2>&1 &&
    command -v pandoc >/dev/null 2>&1 &&
    command -v makeindex >/dev/null 2>&1 &&
    kpsewhich luaotfload.sty >/dev/null 2>&1 &&
    kpsewhich memoir.cls >/dev/null 2>&1 &&
    kpsewhich tcolorbox.sty >/dev/null 2>&1
}

if have_everything; then
  echo "manual toolchain already present: $(lualatex --version | head -1)"
  exit 0
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer handles Ubuntu and Debian only." >&2
  echo "Install the equivalents of: ${PACKAGES[*]}" >&2
  exit 1
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || {
    echo "Need root or sudo to install: ${PACKAGES[*]}" >&2
    exit 1
  }
  SUDO="sudo"
fi

echo "installing the manual toolchain: ${PACKAGES[*]}"
$SUDO apt-get update -qq
DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y --no-install-recommends "${PACKAGES[@]}"

# Say so plainly rather than letting the build fail later with a missing .sty.
if ! have_everything; then
  echo "the toolchain is still incomplete after installing; check the output above" >&2
  exit 1
fi
echo "manual toolchain ready: $(lualatex --version | head -1)"
