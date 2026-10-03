/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.util.concurrent.locks.LockSupport

/** The time source [AudioPipeline]'s player loop reads and waits on. */
internal interface PipelineClock {
  fun nanoTime(): Long

  fun park(nanos: Long)

  companion object {
    val SYSTEM: PipelineClock =
        object : PipelineClock {
          override fun nanoTime(): Long = System.nanoTime()

          override fun park(nanos: Long) = LockSupport.parkNanos(nanos)
        }
  }
}
