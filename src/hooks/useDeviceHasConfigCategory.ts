/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useC64Categories } from "@/hooks/useC64Connection";

/**
 * Whether the connected device lists a config category. False until its own list has loaded: a model without the
 * category (an Ultimate 64 has no Keyboard Lighting) answers a read of it with 404.
 */
export const useDeviceHasConfigCategory = (category: string): boolean => {
  const { data, isPlaceholderData } = useC64Categories();
  return !isPlaceholderData && Boolean(data?.categories?.includes(category));
};
