/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.hvsc

import android.util.Base64
import java.io.File
import org.json.JSONObject

/** Where an ingest leaves its songs' headers, relative to the app's files directory (Capacitor's Data directory). */
const val SID_HEADER_INDEX_PATH = "hvsc/index/ingested-sid-headers.json"

/**
 * Writes a JSON object mapping each song's virtual path to its raw header, base64-encoded, and returns
 * the path the JS side reads it from.
 *
 * The headers are handed over unparsed so that the browse index is filled by the same
 * `parseSidHeaderMetadata` that metadata hydration runs on a whole file; a second parser here would
 * have to keep its text decoding, subsong clamping and SID address rules identical to that one.
 */
fun writeSidHeaderIndex(filesDir: File, songs: List<ExtractedSong>): String {
  val target = File(filesDir, SID_HEADER_INDEX_PATH)
  target.parentFile?.mkdirs()
  target.bufferedWriter().use { writer ->
    writer.write("{")
    songs.forEachIndexed { index, song ->
      if (index > 0) writer.write(",")
      writer.write(JSONObject.quote(song.virtualPath))
      writer.write(":\"")
      writer.write(Base64.encodeToString(song.sidHeader, Base64.NO_WRAP))
      writer.write("\"")
    }
    writer.write("}")
  }
  return SID_HEADER_INDEX_PATH
}
