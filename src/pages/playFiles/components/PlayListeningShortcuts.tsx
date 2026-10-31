/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { ProfileActionGrid } from "@/components/layout/PageContainer";
import { QuickActionCard } from "@/components/QuickActionCard";
import { Button } from "@/components/ui/button";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useStableNavigate } from "@/hooks/useStableNavigate";
import { HomeSearchField } from "@/pages/home/components/HomeSearchField";
import { useListenActions } from "@/pages/home/components/useListenActions";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { START_LISTENING_COPY } from "@/lib/appMode/copy";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";
import { isNetworkKnownOffline, subscribeNetworkEdges } from "@/lib/connection/networkStatusWatch";
import { loadSidRadioEnabled } from "@/lib/config/appSettings";

const useNetworkAvailable = (): boolean => {
  const [available, setAvailable] = useState(() => !isNetworkKnownOffline());
  useEffect(() => subscribeNetworkEdges((edge) => setAvailable(edge === "online")), []);
  return available;
};

type StartAction = { id: string; label: string; link: string; primary: boolean };

/**
 * What a person with an empty playlist can do next, in order, with the first being the one press that leads to
 * music: the free collection while it is missing, a station once it is installed, their own files when there is no
 * network to fetch the collection over.
 */
export const startListeningActions = ({
  hvscEnabled,
  hvscInstalled,
  radioEnabled,
  archiveEnabled,
  online,
}: {
  hvscEnabled: boolean;
  hvscInstalled: boolean;
  radioEnabled: boolean;
  archiveEnabled: boolean;
  online: boolean;
}): StartAction[] => {
  const copy = START_LISTENING_COPY;
  const collection = hvscEnabled && !hvscInstalled && online;
  const station = hvscEnabled && hvscInstalled && radioEnabled;
  const lead: StartAction[] = collection
    ? [{ id: "collection", label: copy.collection, link: "/play?collection=1", primary: true }]
    : station
      ? [{ id: "station", label: copy.station, link: "/play?radio=1", primary: true }]
      : [];
  return [
    ...lead,
    { id: "add-files", label: copy.addFiles, link: "/play?add=1", primary: lead.length === 0 },
    ...(archiveEnabled && online
      ? [{ id: "archive", label: copy.archive, link: "/play?archive=1", primary: false }]
      : []),
  ];
};

const StartListening = ({ hvscInstalled }: { hvscInstalled: boolean }) => {
  const navigate = useStableNavigate();
  const { flags } = useFeatureFlags();
  const online = useNetworkAvailable();
  const listenActions = useListenActions();
  const actions = startListeningActions({
    hvscEnabled: flags.hvsc_enabled,
    hvscInstalled,
    radioEnabled: loadSidRadioEnabled(),
    archiveEnabled: flags.commoserve_enabled,
    online,
  });
  const collectionMissingOffline = flags.hvsc_enabled && !hvscInstalled && !online;

  return (
    <section className="space-y-3" data-testid="start-listening" data-section-label={START_LISTENING_COPY.title}>
      <h2 className="text-base font-semibold">{START_LISTENING_COPY.title}</h2>
      <div className="grid gap-2">
        {actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant={action.primary ? "default" : "outline"}
            className="min-h-11 w-full justify-start whitespace-normal text-left"
            data-testid={`start-listening-${action.id}`}
            onClick={() => navigate(action.link)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {collectionMissingOffline ? (
        <p className="text-sm text-muted-foreground" data-testid="start-listening-offline-note">
          {START_LISTENING_COPY.offline}
        </p>
      ) : null}
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
    </section>
  );
};

/** Search, and while the playlist is empty the Start listening area, on Play in SID Player, where Home is not a page. */
export const PlayListeningShortcuts = ({
  playlistEmpty,
  hvscInstalled,
}: {
  playlistEmpty: boolean;
  hvscInstalled: boolean;
}) =>
  isSurfaceVisible("play:listening-shortcuts", useAppMode()) ? (
    <>
      <HomeSearchField />
      {playlistEmpty ? <StartListening hvscInstalled={hvscInstalled} /> : null}
    </>
  ) : null;
