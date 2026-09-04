package uk.gleissner.c64commander

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import uk.gleissner.c64commander.hvsc.HvscDownloadCancelledException
import uk.gleissner.c64commander.hvsc.HvscResumableDownload

/**
 * Exercises the resume path against a real HTTP server so the `Range` request, the `Content-Range`
 * response and the append are all genuine rather than mocked. See HARD27-028.
 */
class HvscResumableDownloadTest {
  private lateinit var server: HttpServer
  private lateinit var workDir: File
  private lateinit var partFile: File
  private lateinit var targetFile: File

  /** The archive the fake origin serves. Deterministic so a resumed file can be compared byte for byte. */
  private val body = ByteArray(512 * 1024) { (it % 251).toByte() }

  /** Set by a test to make the origin ignore `Range`, answer 416, or truncate the body. */
  private var rangeSupported = true
  private var forceRangeNotSatisfiable = false
  private var truncateResponseAfterBytes: Int? = null
  private var omitContentLength = false
  private var contentRangeStartOverride: Long? = null
  private val requestedRanges = mutableListOf<String?>()
  private val requestCount = AtomicInteger(0)

  @Before
  fun setUp() {
    workDir = Files.createTempDirectory("hvsc-resume-").toFile()
    partFile = File(workDir, "cache/HVSC_85.zip.part")
    targetFile = File(workDir, "cache/HVSC_85.zip")
    server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/archive.zip") { exchange -> serveArchive(exchange) }
    server.executor = null
    server.start()
  }

  @After
  fun tearDown() {
    server.stop(0)
    workDir.deleteRecursively()
  }

  private fun serveArchive(exchange: HttpExchange) {
    requestCount.incrementAndGet()
    val rangeHeader = exchange.requestHeaders.getFirst("Range")
    requestedRanges.add(rangeHeader)
    exchange.use {
      if (forceRangeNotSatisfiable && rangeHeader != null) {
        exchange.sendResponseHeaders(416, -1)
        return
      }
      val start =
              if (rangeSupported && rangeHeader != null) {
                rangeHeader.removePrefix("bytes=").substringBefore('-').toLong()
              } else {
                0L
              }
      val slice = body.copyOfRange(start.toInt(), body.size)
      val declaredLength = slice.size.toLong()
      if (start > 0L) {
        val reportedStart = contentRangeStartOverride ?: start
        exchange.responseHeaders.add(
                "Content-Range",
                "bytes $reportedStart-${body.size - 1}/${body.size}",
        )
        exchange.sendResponseHeaders(206, declaredLength)
      } else if (omitContentLength) {
        // 0 makes HttpServer answer with chunked encoding, so a short body ends in a clean EOF
        // rather than the stream error a declared Content-Length would produce.
        exchange.sendResponseHeaders(200, 0)
      } else {
        exchange.sendResponseHeaders(200, declaredLength)
      }
      val writeLimit = truncateResponseAfterBytes?.coerceAtMost(slice.size) ?: slice.size
      exchange.responseBody.write(slice, 0, writeLimit)
      exchange.responseBody.flush()
    }
  }

  private fun url() = "http://127.0.0.1:${server.address.port}/archive.zip"

  private fun downloader() = HvscResumableDownload()

  @Test
  fun `a fresh download writes the whole archive and promotes the part file`() {
    val outcome =
            downloader()
                    .download(
                            url = url(),
                            partFile = partFile,
                            targetFile = targetFile,
                            expectedTotalBytes = body.size.toLong(),
                    )

    assertEquals(body.size.toLong(), outcome.totalBytes)
    assertEquals(0L, outcome.resumedFromBytes)
    assertEquals(body.size.toLong(), outcome.transferredBytes)
    assertArrayEquals(body, targetFile.readBytes())
    assertFalse("the part sidecar must not survive a promotion", partFile.exists())
    assertEquals(listOf<String?>(null), requestedRanges)
  }

  @Test
  fun `a second attempt resumes from the bytes already on disk instead of restarting`() {
    val alreadyDownloaded = 20_000
    partFile.parentFile.mkdirs()
    partFile.writeBytes(body.copyOfRange(0, alreadyDownloaded))

    val outcome =
            downloader()
                    .download(
                            url = url(),
                            partFile = partFile,
                            targetFile = targetFile,
                            expectedTotalBytes = body.size.toLong(),
                    )

    assertEquals(listOf("bytes=$alreadyDownloaded-"), requestedRanges)
    assertEquals(alreadyDownloaded.toLong(), outcome.resumedFromBytes)
    assertEquals((body.size - alreadyDownloaded).toLong(), outcome.transferredBytes)
    assertArrayEquals(body, targetFile.readBytes())
  }

  @Test
  fun `progress is reported against the whole archive, not just the resumed remainder`() {
    val alreadyDownloaded = 40_000
    partFile.parentFile.mkdirs()
    partFile.writeBytes(body.copyOfRange(0, alreadyDownloaded))
    val progress = mutableListOf<Pair<Long, Long>>()

    downloader()
            .download(
                    url = url(),
                    partFile = partFile,
                    targetFile = targetFile,
                    expectedTotalBytes = body.size.toLong(),
                    onProgress = { downloaded, total -> progress.add(downloaded to total) },
            )

    val last = progress.last()
    assertEquals(body.size.toLong(), last.first)
    assertEquals(body.size.toLong(), last.second)
    assertTrue(
            "every progress sample must already include the resumed bytes",
            progress.all { it.first >= alreadyDownloaded },
    )
  }

  /**
   * The caller omits `expectedTotalBytes` whenever the HEAD that would have measured the archive
   * failed (`hvscResumableDownload.ts`), so a completeness check gated on it alone checks nothing
   * on exactly the path where the size is least certain. The response's own `Content-Range` total
   * has to stand in, or a truncated body is promoted over the real archive and the resume state is
   * gone.
   */
  @Test
  fun `a truncated resume is rejected using the size the response declared`() {
    partFile.parentFile.mkdirs()
    partFile.writeBytes(body.copyOfRange(0, 100_000))
    truncateResponseAfterBytes = 5_000

    val error =
            try {
              downloader()
                      .download(
                              url = url(),
                              partFile = partFile,
                              targetFile = targetFile,
                      )
              null
            } catch (thrown: Exception) {
              thrown
            }

    assertTrue("the short download must fail rather than promote", error is java.io.IOException)
    assertTrue(
            "the message must name the shortfall: ${error?.message}",
            error?.message?.contains("incomplete") == true,
    )
    assertFalse("a short archive must not be promoted", targetFile.exists())
    assertEquals(
            "the part file is kept so the next attempt resumes",
            105_000L,
            partFile.length(),
    )
  }

  @Test
  fun `a server that ignores Range is not appended to`() {
    rangeSupported = false
    partFile.parentFile.mkdirs()
    partFile.writeBytes(body.copyOfRange(0, 12_345))

    val outcome =
            downloader()
                    .download(
                            url = url(),
                            partFile = partFile,
                            targetFile = targetFile,
                            expectedTotalBytes = body.size.toLong(),
                    )

    assertEquals(0L, outcome.resumedFromBytes)
    assertEquals(body.size.toLong(), outcome.transferredBytes)
    assertArrayEquals(body, targetFile.readBytes())
    assertEquals(1, requestCount.get())
  }

  @Test
  fun `a 416 discards the stale part and downloads the archive from the first byte`() {
    forceRangeNotSatisfiable = true
    partFile.parentFile.mkdirs()
    partFile.writeBytes(ByteArray(9_000) { 0x7f })

    val outcome =
            downloader()
                    .download(
                            url = url(),
                            partFile = partFile,
                            targetFile = targetFile,
                            expectedTotalBytes = body.size.toLong(),
                    )

    assertEquals(listOf("bytes=9000-", null), requestedRanges)
    assertEquals(0L, outcome.resumedFromBytes)
    assertArrayEquals(body, targetFile.readBytes())
  }

  @Test
  fun `a 206 that starts at the wrong offset is not appended to`() {
    contentRangeStartOverride = 0L
    partFile.parentFile.mkdirs()
    partFile.writeBytes(body.copyOfRange(0, 15_000))

    val outcome =
            downloader()
                    .download(
                            url = url(),
                            partFile = partFile,
                            targetFile = targetFile,
                            expectedTotalBytes = body.size.toLong(),
                    )

    assertEquals(0L, outcome.resumedFromBytes)
    assertArrayEquals(body, targetFile.readBytes())
  }

  @Test
  fun `a part longer than the archive is discarded rather than resumed`() {
    partFile.parentFile.mkdirs()
    partFile.writeBytes(ByteArray(body.size + 4_096) { 0x11 })

    downloader()
            .download(
                    url = url(),
                    partFile = partFile,
                    targetFile = targetFile,
                    expectedTotalBytes = body.size.toLong(),
            )

    assertEquals(listOf<String?>(null), requestedRanges)
    assertArrayEquals(body, targetFile.readBytes())
  }

  @Test
  fun `a complete part is promoted without another request`() {
    partFile.parentFile.mkdirs()
    partFile.writeBytes(body)

    val outcome =
            downloader()
                    .download(
                            url = url(),
                            partFile = partFile,
                            targetFile = targetFile,
                            expectedTotalBytes = body.size.toLong(),
                    )

    assertEquals(0, requestCount.get())
    assertEquals(body.size.toLong(), outcome.totalBytes)
    assertArrayEquals(body, targetFile.readBytes())
  }

  @Test
  fun `a short body keeps the part so the next attempt continues from it`() {
    omitContentLength = true
    truncateResponseAfterBytes = 25_000

    val error =
            runCatching {
                      downloader()
                              .download(
                                      url = url(),
                                      partFile = partFile,
                                      targetFile = targetFile,
                                      expectedTotalBytes = body.size.toLong(),
                              )
                    }
                    .exceptionOrNull()

    assertTrue("expected the short transfer to fail, got $error", error is java.io.IOException)
    assertTrue(error!!.message!!.contains("a retry will resume"))
    assertEquals(25_000L, partFile.length())
    assertFalse("a failed transfer must not promote a short archive", targetFile.exists())

    omitContentLength = false
    truncateResponseAfterBytes = null
    val outcome =
            downloader()
                    .download(
                            url = url(),
                            partFile = partFile,
                            targetFile = targetFile,
                            expectedTotalBytes = body.size.toLong(),
                    )
    assertEquals(25_000L, outcome.resumedFromBytes)
    assertEquals(listOf(null, "bytes=25000-"), requestedRanges)
    assertArrayEquals(body, targetFile.readBytes())
  }

  @Test
  fun `a cancelled transfer keeps the bytes it already wrote`() {
    // Cancels as soon as any byte has reached the sidecar, so the assertion below is about the
    // bytes that survive rather than about how many read loops happened to run.
    val error =
            runCatching {
                      downloader()
                              .download(
                                      url = url(),
                                      partFile = partFile,
                                      targetFile = targetFile,
                                      expectedTotalBytes = body.size.toLong(),
                                      isCancelled = { partFile.length() > 0L },
                              )
                    }
                    .exceptionOrNull()

    assertTrue("expected cancellation, got $error", error is HvscDownloadCancelledException)
    assertFalse("a cancelled transfer must not promote a partial archive", targetFile.exists())
    assertTrue("the bytes read before the cancellation must survive", partFile.length() > 0L)
    assertTrue(partFile.length() < body.size.toLong())
  }

  @Test
  fun `an HTTP error is reported with its status and leaves no archive behind`() {
    val error =
            runCatching {
                      downloader()
                              .download(
                                      url = "http://127.0.0.1:${server.address.port}/missing.zip",
                                      partFile = partFile,
                                      targetFile = targetFile,
                                      expectedTotalBytes = body.size.toLong(),
                              )
                    }
                    .exceptionOrNull()

    assertTrue(error is java.io.IOException)
    assertTrue(error!!.message!!.contains("HTTP ${HttpURLConnection.HTTP_NOT_FOUND}"))
    assertFalse(targetFile.exists())
  }
}
