/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Fragment } from "react";
import { cn } from "@/lib/utils";

const AFTER_SEPARATOR_RUN = /(?<=[_\-./\\)])(?![_\-./\\)])/;

/** Splits a file name after each run of `_ - . / \ )`, the places a name like `Turrican_(Original)_S1.d64` reads naturally across lines. */
export const splitNameAtSeparators = (name: string): string[] => name.split(AFTER_SEPARATOR_RUN).filter(Boolean);

type NameWrapProps = {
  name: string;
  className?: string;
};

/**
 * Renders a file name that wraps at its separators rather than between two letters. The parts are
 * plain text nodes around `<wbr>`, so the element's text content is the unchanged name.
 */
export const NameWrap = ({ name, className }: NameWrapProps) => (
  <span className={cn("break-words", className)}>
    {splitNameAtSeparators(name).map((part, index) => (
      <Fragment key={index}>
        {index > 0 ? <wbr /> : null}
        {part}
      </Fragment>
    ))}
  </span>
);
