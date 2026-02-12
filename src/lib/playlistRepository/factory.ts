import { isNativePlatform } from '@/lib/native/platform';
import type { PlaylistDataRepository } from './repository';
import { getIndexedDbPlaylistDataRepository } from './indexedDbRepository';
import { getLocalStoragePlaylistDataRepository } from './localStorageRepository';

let repository: PlaylistDataRepository | null = null;

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

export const getPlaylistDataRepository = (): PlaylistDataRepository => {
  if (repository) return repository;

  if (isNativePlatform() && canUseIndexedDb()) {
    repository = getIndexedDbPlaylistDataRepository({
      preferDurableStorage: true,
    });
    return repository;
  }

  repository = getLocalStoragePlaylistDataRepository();
  return repository;
};

export const resetPlaylistDataRepositoryForTests = () => {
  repository = null;
};
