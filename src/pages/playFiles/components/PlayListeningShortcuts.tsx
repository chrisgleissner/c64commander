/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ProfileActionGrid } from "@/components/layout/PageContainer";
import { QuickActionCard } from "@/components/QuickActionCard";
import { HomeSearchField } from "@/pages/home/components/HomeSearchField";
import { useListenActions } from "@/pages/home/components/useListenActions";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";

const ListeningShortcuts = ({ playlistEmpty }: { playlistEmpty: boolean }) => {
  const listenActions = useListenActions();
  return (
    <>
      <HomeSearchField />
      {playlistEmpty ? (
        <ProfileActionGrid
          compactColumns={2}
          mediumColumns={3}
          expandedColumns={3}
          cardDensity="compact"
          testId="play-listening-shortcuts"
        >
          {listenActions.map((action) => (
            <QuickActionCard
              key={action.id}
              icon={action.icon}
              label={action.label}
              description={action.description ?? undefined}
              disabled={action.disabled}
              onClick={action.onSelect}
              dataTestId={action.testId}
              focusId={action.focusId}
            />
          ))}
        </ProfileActionGrid>
      ) : null}
    </>
  );
};

/** Search, and while the playlist is empty the listening tiles, on Play in SID Player, where Home is not a page. */
export const PlayListeningShortcuts = ({ playlistEmpty }: { playlistEmpty: boolean }) =>
  isSurfaceVisible("play:listening-shortcuts", useAppMode()) ? (
    <ListeningShortcuts playlistEmpty={playlistEmpty} />
  ) : null;
