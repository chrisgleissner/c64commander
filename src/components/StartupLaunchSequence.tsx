/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";

import { variant } from "@/generated/variant";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import {
  markStartupLaunchSequenceComplete,
  type LaunchSequencePhase,
  resolveStartupLaunchSequenceTimings,
  runLaunchSequence,
  shouldShowStartupLaunchSequence,
} from "@/lib/startup/launchSequence";

const PROFILE_COPY_WIDTH = {
  compact: "min(88vw, 16rem)",
  medium: "min(54vw, 20rem)",
  expanded: "min(46vw, 24rem)",
} as const;

const PROFILE_LOGO_WIDTH = {
  compact: "min(54vw, 10rem)",
  medium: "min(50vw, 12.5rem)",
  expanded: "min(46vw, 14rem)",
} as const;

export function StartupLaunchSequence() {
  const { profile } = useDisplayProfile();
  const timings = React.useMemo(() => resolveStartupLaunchSequenceTimings(), []);
  const [phase, setPhase] = React.useState<LaunchSequencePhase>("fade-in");
  const [visible, setVisible] = React.useState(() => shouldShowStartupLaunchSequence());
  const launchSequenceStyle = {
    backgroundColor: variant.platform.web.backgroundColor,
    "--startup-launch-copy-width": PROFILE_COPY_WIDTH[profile],
    "--startup-launch-fade-in-ms": `${timings.fadeInMs}ms`,
    "--startup-launch-fade-out-ms": `${timings.fadeOutMs}ms`,
    "--startup-launch-logo-width": PROFILE_LOGO_WIDTH[profile],
  } as React.CSSProperties;

  React.useEffect(() => {
    if (!visible) {
      return undefined;
    }

    return runLaunchSequence({
      timings,
      onPhaseChange: (nextPhase) => {
        setPhase(nextPhase);
        if (nextPhase === "app-ready") {
          markStartupLaunchSequenceComplete();
          setVisible(false);
        }
      },
    });
  }, [timings, visible]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="startup-launch-sequence"
      data-fade-in-ms={timings.fadeInMs}
      data-fade-out-ms={timings.fadeOutMs}
      data-hold-ms={timings.holdMs}
      data-phase={phase}
      data-profile={profile}
      data-testid="startup-launch-sequence"
      style={launchSequenceStyle}
    >
      <div className="startup-launch-sequence__halo" aria-hidden="true" />
      <div className="startup-launch-sequence__content">
        <img
          alt={`${variant.displayName} logo`}
          className="startup-launch-sequence__logo"
          data-testid="startup-launch-sequence-logo"
          src={variant.assets.public.homeLogoPng}
        />
        <h1 className="startup-launch-sequence__title" data-testid="startup-launch-sequence-title">
          {variant.displayName}
        </h1>
        <p className="startup-launch-sequence__description" data-testid="startup-launch-sequence-description">
          {variant.description}
        </p>
      </div>
    </div>
  );
}
