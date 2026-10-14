/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package com.getcapacitor

import android.net.Uri
import android.webkit.WebResourceRequest
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

/**
 * Covers the patch in `patches/@capacitor+android+*.patch`. Lives in Capacitor's package because the
 * server's constructor is package-private.
 */
@RunWith(RobolectricTestRunner::class)
class WebViewLocalServerFileCloseTest {
  @get:Rule val tempFolder = TemporaryFolder()

  private fun descriptorsOpenOn(file: File): Int {
    val target = file.canonicalPath
    return File("/proc/self/fd").listFiles().orEmpty().count { link ->
      runCatching { Files.readSymbolicLink(link.toPath()).toString() == target }.getOrDefault(false)
    }
  }

  private fun fileRequest(file: File): WebResourceRequest {
    val request = mock(WebResourceRequest::class.java)
    `when`(request.url).thenReturn(Uri.parse("https://localhost${Bridge.CAPACITOR_FILE_START}${file.canonicalPath}"))
    `when`(request.requestHeaders).thenReturn(emptyMap())
    `when`(request.method).thenReturn("GET")
    return request
  }

  @Test
  fun closingAServedFileResponseClosesTheFileItWasReadFrom() {
    assumeTrue("needs /proc/self/fd to see open descriptors", File("/proc/self/fd").isDirectory)
    val file = tempFolder.newFile("Songlengths.md5").apply { writeText("[Database]\n") }
    val bridge = mock(Bridge::class.java)
    `when`(bridge.scheme).thenReturn("https")
    val server = WebViewLocalServer(ApplicationProvider.getApplicationContext(), bridge, null, arrayListOf("localhost"), true)
    server.hostAssets("public")

    val response = server.shouldInterceptRequest(fileRequest(file))
    assertNotNull("a _capacitor_file_ URL is served from disk", response)
    val stream = response!!.data
    assertEquals("[Database]\n", stream.readBytes().decodeToString())
    assertEquals("the file is open while the WebView reads it", 1, descriptorsOpenOn(file))

    stream.close()

    assertEquals("closing the response must close the file", 0, descriptorsOpenOn(file))
  }
}
