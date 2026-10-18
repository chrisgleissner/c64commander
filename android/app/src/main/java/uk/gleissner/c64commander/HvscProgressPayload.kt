/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.JSObject

/** The payload of an `hvscProgress` event: counts and a percentage when the total is known. */
internal fun hvscProgressPayload(
        stage: String,
        message: String,
        processedCount: Int,
        totalCount: Int?,
        currentFile: String?,
        songsIngested: Int,
        songsDeleted: Int,
): JSObject {
  val payload = JSObject()
  payload.put("stage", stage)
  payload.put("message", message)
  payload.put("processedCount", processedCount)
  payload.put("songsUpserted", songsIngested)
  payload.put("songsDeleted", songsDeleted)
  if (totalCount != null && totalCount > 0) {
    payload.put("totalCount", totalCount)
    payload.put("percent", ((processedCount.toDouble() / totalCount.toDouble()) * 100.0).toInt())
  }
  if (!currentFile.isNullOrBlank()) payload.put("currentFile", currentFile)
  return payload
}
