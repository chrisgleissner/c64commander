/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

#pragma once

#include <memory>
#include <mutex>

#include "ez_session.h"

namespace c64commander {

/** A session behind an opaque JNI id: the session and the lock every call on it holds. */
struct SessionHandle {
  std::mutex lock;
  std::unique_ptr<EzSession> session;
};

/**
 * Run `body` on the handle's session while holding its lock, or return `destroyed()` when the
 * session is gone. A call can find the handle just before a destroy empties it, so the check has to
 * happen under the lock, after any destroy that got there first.
 */
template <typename Body, typename Destroyed>
auto runLocked(SessionHandle& handle, Destroyed destroyed, Body body) {
  std::lock_guard<std::mutex> guard(handle.lock);
  if (!handle.session) return destroyed();
  return body(*handle.session);
}

} // namespace c64commander
