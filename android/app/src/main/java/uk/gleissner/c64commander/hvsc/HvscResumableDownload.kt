/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.hvsc

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.regex.Pattern

/** Result of one completed [HvscResumableDownload.download]. */
data class HvscDownloadOutcome(
        val totalBytes: Long,
        val resumedFromBytes: Long,
        val transferredBytes: Long,
)

/** Thrown when the caller's cancellation predicate turns true mid-transfer. */
class HvscDownloadCancelledException(message: String) : InterruptedIOException(message)

/**
 * Downloads the HVSC archive into a `.part` sidecar and promotes it by rename, so an interrupted
 * transfer resumes with a `Range` request instead of restarting from the first byte. Capacitor's
 * `Filesystem.downloadFile` cannot do this: it forwards request headers but opens the destination
 * with `FileOutputStream(file, false)`, so a 206 body would be written at offset 0. See HARD27-028.
 */
class HvscResumableDownload(
        private val connectionFactory: (String) -> HttpURLConnection = { url ->
          URL(url).openConnection() as HttpURLConnection
        },
) {
  fun download(
          url: String,
          partFile: File,
          targetFile: File,
          expectedTotalBytes: Long? = null,
          isCancelled: () -> Boolean = { false },
          onProgress: (downloadedBytes: Long, totalBytes: Long) -> Unit = { _, _ -> },
  ): HvscDownloadOutcome {
    partFile.parentFile?.mkdirs()
    targetFile.parentFile?.mkdirs()

    var resumeFrom = usablePartBytes(partFile, expectedTotalBytes)
    if (expectedTotalBytes != null && expectedTotalBytes > 0L && resumeFrom == expectedTotalBytes) {
      onProgress(resumeFrom, expectedTotalBytes)
      promote(partFile, targetFile)
      return HvscDownloadOutcome(targetFile.length(), resumeFrom, 0L)
    }

    var transferred = 0L
    var attempts = 0
    // The size the response itself declared, so a transfer that ends early is caught even when the
    // caller could not supply an expected size. `hvscResumableDownload.ts` omits it whenever the
    // HEAD that would have measured the archive failed, and without this check a connection closed
    // mid-body ended the read loop with no exception at all: the short `.part` was then promoted
    // over the real archive, so the resume state was destroyed and the failure only surfaced as an
    // opaque 7z extraction error.
    var declaredTotalBytes = 0L
    while (true) {
      if (isCancelled()) throw HvscDownloadCancelledException("HVSC download cancelled")
      attempts++
      val connection = connectionFactory(url)
      var retryFromStart = false
      try {
        connection.requestMethod = "GET"
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.setRequestProperty("Accept-Encoding", "identity")
        if (resumeFrom > 0L) connection.setRequestProperty("Range", "bytes=$resumeFrom-")

        val status = connection.responseCode
        val rangeStart = contentRangeField(connection, RANGE_START_GROUP)
        // 416 and a 206 that starts somewhere else both mean the part does not belong to this
        // resource, so there is nothing to continue from.
        val mismatched =
                status == HTTP_RANGE_NOT_SATISFIABLE ||
                        (resumeFrom > 0L &&
                                status == HttpURLConnection.HTTP_PARTIAL &&
                                rangeStart != resumeFrom)
        if (mismatched) {
          if (attempts > 1) {
            throw IOException(
                    "HVSC download could not restart from the first byte: HTTP $status, Content-Range start $rangeStart"
            )
          }
          retryFromStart = true
          continue
        }
        if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
          throw IOException("HVSC download failed: HTTP $status ${connection.responseMessage}")
        }
        // A server that ignores the Range answers 200 with the whole body; rewrite from scratch
        // rather than appending it to what is already on disk.
        val append = resumeFrom > 0L && status == HttpURLConnection.HTTP_PARTIAL
        if (!append) resumeFrom = 0L
        val totalBytes = resolveTotalBytes(connection, resumeFrom, expectedTotalBytes)
        declaredTotalBytes = totalBytes
        transferred =
                copyBody(connection, partFile, append, resumeFrom, totalBytes, isCancelled, onProgress)
        break
      } finally {
        connection.disconnect()
        if (retryFromStart) {
          partFile.delete()
          resumeFrom = 0L
        }
      }
    }

    val writtenBytes = partFile.length()
    // The caller's figure wins where it has one, because it came from the version manifest rather
    // than from the same response being checked.
    val requiredBytes =
            if (expectedTotalBytes != null && expectedTotalBytes > 0L) expectedTotalBytes
            else declaredTotalBytes
    if (requiredBytes > 0L && writtenBytes != requiredBytes) {
      if (writtenBytes > requiredBytes) {
        partFile.delete()
        throw IOException(
                "HVSC download wrote $writtenBytes bytes, more than the expected $requiredBytes; the partial file was discarded"
        )
      }
      // Keep the short part: the next attempt continues from where this one stopped.
      throw IOException(
              "HVSC download is incomplete: $writtenBytes of $requiredBytes bytes; a retry will resume"
      )
    }

    promote(partFile, targetFile)
    return HvscDownloadOutcome(targetFile.length(), resumeFrom, transferred)
  }

  private fun usablePartBytes(partFile: File, expectedTotalBytes: Long?): Long {
    if (!partFile.isFile) return 0L
    val length = partFile.length().coerceAtLeast(0L)
    if (expectedTotalBytes != null && expectedTotalBytes > 0L && length > expectedTotalBytes) {
      partFile.delete()
      return 0L
    }
    return length
  }

  private fun resolveTotalBytes(
          connection: HttpURLConnection,
          resumeFrom: Long,
          expectedTotalBytes: Long?,
  ): Long {
    val fromContentRange = contentRangeField(connection, RANGE_TOTAL_GROUP)
    if (fromContentRange != null && fromContentRange > 0L) return fromContentRange
    val contentLength = connection.contentLengthLong
    if (contentLength > 0L) return resumeFrom + contentLength
    return expectedTotalBytes ?: 0L
  }

  private fun contentRangeField(connection: HttpURLConnection, group: Int): Long? {
    val header = connection.getHeaderField("Content-Range") ?: return null
    val matcher = CONTENT_RANGE_PATTERN.matcher(header)
    if (!matcher.find()) return null
    return matcher.group(group)?.toLongOrNull()
  }

  private fun copyBody(
          connection: HttpURLConnection,
          partFile: File,
          append: Boolean,
          resumeFrom: Long,
          totalBytes: Long,
          isCancelled: () -> Boolean,
          onProgress: (Long, Long) -> Unit,
  ): Long {
    var transferred = 0L
    var lastEmitAt = 0L
    connection.inputStream.use { input ->
      FileOutputStream(partFile, append).use { output ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          if (isCancelled()) {
            output.flush()
            output.fd.sync()
            throw HvscDownloadCancelledException("HVSC download cancelled")
          }
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
          transferred += read
          val now = System.currentTimeMillis()
          if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
            lastEmitAt = now
            onProgress(resumeFrom + transferred, totalBytes)
          }
        }
        output.flush()
        // Without the fsync a process kill can lose the tail of the part, and the resume would
        // then continue from a byte offset the file does not actually contain.
        output.fd.sync()
      }
    }
    onProgress(resumeFrom + transferred, totalBytes)
    return transferred
  }

  private fun promote(partFile: File, targetFile: File) {
    if (targetFile.exists() && !targetFile.delete()) {
      throw IOException("Failed to replace HVSC archive at ${targetFile.absolutePath}")
    }
    if (partFile.renameTo(targetFile)) return
    partFile.copyTo(targetFile, overwrite = true)
    partFile.delete()
  }

  private companion object {
    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val BUFFER_BYTES = 64 * 1024
    private const val PROGRESS_INTERVAL_MS = 100L
    private const val HTTP_RANGE_NOT_SATISFIABLE = 416
    private const val RANGE_START_GROUP = 1
    private const val RANGE_TOTAL_GROUP = 3
    private val CONTENT_RANGE_PATTERN =
            Pattern.compile("bytes\\s+(\\d+)-(\\d+)/(\\d+)", Pattern.CASE_INSENSITIVE)
  }
}
