/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FtpListingErrorsTest {
  private val pattern = Regex("\\b(timed out|timeout)\\b", RegexOption.IGNORE_CASE)

  @Test
  fun refusedListingOfAFolderNamedTimeoutKeepsItsReply() {
    val error = FtpListRefusedException("/USB0/Demos/Timeout", 550, "no such folder")
    val message = ftpFailureMessage("listDirectory", error, 1500, 5000, pattern)
    assertTrue(message, message.contains("550"))
    assertTrue(message, !message.contains("timed out after"))
  }

  @Test
  fun aSocketTimeoutIsReportedAsATimeout() {
    val message = ftpFailureMessage("listDirectory", SocketTimeoutException("Read timed out"), 1500, 5000, pattern)
    assertEquals("FTP listDirectory timed out after connect 1500ms / transfer 5000ms", message)
  }

  @Test
  fun anErrorWhoseMessageSaysTimeoutIsReportedAsATimeout() {
    val message = ftpFailureMessage("readFile", java.io.IOException("data channel timeout"), 1500, 5000, pattern)
    assertEquals("FTP readFile timed out after connect 1500ms / transfer 5000ms", message)
  }
}
