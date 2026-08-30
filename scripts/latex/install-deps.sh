#!/usr/bin/env bash
# Installs the toolchain that typesets the manual, if it is not already there.
#
# One list, two callers: `./build --manual` runs this before building, and so
# does the manual workflow in CI. Keeping the list in one file is what stops a
# green CI run from meaning nothing about whether a contributor can build the
# book on their own machine.
#
# Deliberately not texlive-full. That is about 6 GB. The manual needs five TeX
# Live packages: the typefaces are vendored in this repository, so no TeX font
# package is involved at all.
#
# pandoc comes from its own release rather than from apt, and lands beside this
# script rather than in the system. Two reasons. Ubuntu's package unpacks 190 MB,
# a third of the whole install, because it drags in a Java PDF stack the manual
# never touches; the upstream tarball is a 35 MB static binary with nothing
# behind it. And the version matters: pandoc 3.11 wraps images in a macro that
# 3.1.3 does not emit, so a machine using its distribution's pandoc produced
# LaTeX that failed to compile. Pinning one version, and preferring it over
# whatever is on PATH, is what makes a local build and a CI build the same
# build.
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
  poppler-utils              # pdffonts and pdfinfo, which the build checks its own output with
)

PANDOC_VERSION=3.11
PANDOC_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin/pandoc"

have_everything() {
  command -v lualatex >/dev/null 2>&1 &&
    [ -x "$PANDOC_BIN" ] &&
    "$PANDOC_BIN" --version | head -1 | grep -q "pandoc $PANDOC_VERSION\$" &&
    command -v makeindex >/dev/null 2>&1 &&
    kpsewhich luaotfload.sty >/dev/null 2>&1 &&
    kpsewhich memoir.cls >/dev/null 2>&1 &&
    kpsewhich tcolorbox.sty >/dev/null 2>&1 &&
    command -v pdffonts >/dev/null 2>&1
}

if have_everything; then
  echo "manual toolchain already present: $(lualatex --version | head -1), $("$PANDOC_BIN" --version | head -1)"
  exit 0
fi

install_pandoc() {
  if [ -x "$PANDOC_BIN" ] && "$PANDOC_BIN" --version | head -1 | grep -q "pandoc $PANDOC_VERSION\$"; then
    return 0
  fi
  echo "installing pandoc $PANDOC_VERSION"
  tmp="$(mktemp -d)"
  url="https://github.com/jgm/pandoc/releases/download/$PANDOC_VERSION/pandoc-$PANDOC_VERSION-linux-amd64.tar.gz"
  curl --fail --silent --show-error --location --retry 3 --retry-delay 2 -o "$tmp/pandoc.tar.gz" "$url"
  tar -xzf "$tmp/pandoc.tar.gz" -C "$tmp"
  mkdir -p "$(dirname "$PANDOC_BIN")"
  install -m 0755 "$tmp/pandoc-$PANDOC_VERSION/bin/pandoc" "$PANDOC_BIN"
  rm -rf "$tmp"
}

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 && SUDO="sudo"
fi

install_pandoc

if have_everything; then
  echo "manual toolchain ready: $(lualatex --version | head -1), $("$PANDOC_BIN" --version | head -1)"
  exit 0
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer handles Ubuntu and Debian only." >&2
  echo "Install the equivalents of: ${PACKAGES[*]}" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
  echo "Need root or sudo to install: ${PACKAGES[*]}" >&2
  exit 1
fi

echo "installing the manual toolchain: ${PACKAGES[*]}"
# Retries, because a mirror that blinks should cost a few seconds rather than a
# red build.
$SUDO apt-get update -qq -o Acquire::Retries=3
DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y --no-install-recommends \
  -o Acquire::Retries=3 "${PACKAGES[@]}"
install_pandoc

# Say so plainly rather than letting the build fail later with a missing .sty.
if ! have_everything; then
  echo "the toolchain is still incomplete after installing; check the output above" >&2
  exit 1
fi
echo "manual toolchain ready: $(lualatex --version | head -1)"
