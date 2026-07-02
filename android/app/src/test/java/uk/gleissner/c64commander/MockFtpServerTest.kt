/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.apache.commons.net.ftp.FTPClient
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Socket

class MockFtpServerTest {
  @get:Rule
  val tempFolder = TemporaryFolder()

  @Test
  fun serverCanBeInstantiatedWithValidRoot() {
    val rootDir = tempFolder.newFolder("ftp-root")
    val server = MockFtpServer(rootDir, null)
    assertNotNull("Server should not be null", server)
  }

  @Test
  fun serverAcceptsPasswordConfiguration() {
    val rootDir = tempFolder.newFolder("ftp-root2")
    val server = MockFtpServer(rootDir, "secret")
    assertNotNull("Server with password should not be null", server)
  }

  @Test
  fun ftpLoginAndPwdFlowResponds() {
    val rootDir = tempFolder.newFolder("ftp-root3")
    java.io.File(rootDir, "demo.sid").writeText("data")
    val server = MockFtpServer(rootDir, "secret")
    val port = server.start()

    val socket = Socket("127.0.0.1", port)
    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
    val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))

    assertTrue(reader.readLine().startsWith("220"))
    writer.write("USER user\r\n")
    writer.flush()
    assertTrue(reader.readLine().startsWith("331"))
    writer.write("PASS secret\r\n")
    writer.flush()
    assertTrue(reader.readLine().startsWith("230"))
    writer.write("PWD\r\n")
    writer.flush()
    assertTrue(reader.readLine().startsWith("257"))

    socket.close()
    server.stop()
  }

  @Test
  fun ftpListUsesPassiveDataConnection() {
    val rootDir = tempFolder.newFolder("ftp-root4")
    java.io.File(rootDir, "demo.sid").writeText("data")
    val server = MockFtpServer(rootDir, null)
    val port = server.start()

    val socket = Socket("127.0.0.1", port)
    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
    val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))

    reader.readLine()
    writer.write("USER user\r\n")
    writer.flush()
    reader.readLine()
    writer.write("PASS anything\r\n")
    writer.flush()
    reader.readLine()

    writer.write("PASV\r\n")
    writer.flush()
    val pasvResponse = reader.readLine()
    val match = Regex("\\((\\d+),(\\d+),(\\d+),(\\d+),(\\d+),(\\d+)\\)").find(pasvResponse)
    assertNotNull(match)
    val p1 = match!!.groupValues[5].toInt()
    val p2 = match.groupValues[6].toInt()
    val dataPort = p1 * 256 + p2
    val dataSocket = Socket("127.0.0.1", dataPort)

    writer.write("LIST\r\n")
    writer.flush()
    assertTrue(reader.readLine().startsWith("150"))
    val listing = dataSocket.getInputStream().bufferedReader().readText()
    dataSocket.close()
    assertTrue(listing.contains("demo.sid"))
    assertTrue(reader.readLine().startsWith("226"))

    socket.close()
    server.stop()
  }

  @Test
  fun ftpClientCommandsExerciseSessionBranches() {
    val rootDir = tempFolder.newFolder("ftp-root5")
    val subDir = java.io.File(rootDir, "sub")
    subDir.mkdirs()
    java.io.File(subDir, "demo.sid").writeText("data")

    val server = MockFtpServer(rootDir, "secret")
    val port = server.start()

    val client = FTPClient()
    client.connect("127.0.0.1", port)
    assertTrue(client.login("user", "secret"))
    client.enterLocalPassiveMode()

    assertTrue(client.changeWorkingDirectory("/sub"))
    assertEquals("/sub", client.printWorkingDirectory())
    assertTrue(client.changeToParentDirectory())
    assertEquals("/", client.printWorkingDirectory())

    val list = client.listNames()
    assertNotNull(list)
    assertTrue(list!!.contains("sub"))

    assertTrue(client.changeWorkingDirectory("/sub"))
    val stream = client.retrieveFileStream("demo.sid")
    assertNotNull(stream)
    stream!!.close()
    assertTrue(client.completePendingCommand())

    client.disconnect()
    server.stop()
  }

  @Test
  fun pathContainmentRejectsSiblingDirectorySharingRootPrefix() {
    val root = tempFolder.newFolder("mock-ftp-root")
    // A sibling directory whose name merely starts with the root's name -
    // "mock-ftp-rootX" - must NOT be treated as contained within "mock-ftp-root".
    val sibling = tempFolder.newFolder("mock-ftp-rootX")

    assertFalse(
            "Sibling directory sharing a string prefix with the root must not pass containment (HARD9-071)",
            isPathContainedInRoot(sibling.canonicalFile.path, root.canonicalFile.path),
    )
  }

  @Test
  fun pathContainmentAcceptsRootItselfAndGenuineChildren() {
    val root = tempFolder.newFolder("mock-ftp-root2")
    val child = java.io.File(root, "sub/demo.sid")
    child.parentFile?.mkdirs()
    child.writeText("data")

    assertTrue(isPathContainedInRoot(root.canonicalFile.path, root.canonicalFile.path))
    assertTrue(isPathContainedInRoot(child.canonicalFile.path, root.canonicalFile.path))
  }

  @Test
  fun passiveDataConnectionTimesOutInsteadOfHangingForeverOnAnUnusedPasv() {
    val rootDir = tempFolder.newFolder("ftp-root6")
    java.io.File(rootDir, "demo.sid").writeText("data")
    val server = MockFtpServer(rootDir, null)
    server.dataConnectionAcceptTimeoutMs = 200
    val port = server.start()

    val socket = Socket("127.0.0.1", port)
    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
    val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))

    reader.readLine()
    writer.write("USER user\r\n")
    writer.flush()
    reader.readLine()
    writer.write("PASS anything\r\n")
    writer.flush()
    reader.readLine()

    writer.write("PASV\r\n")
    writer.flush()
    reader.readLine()

    // Deliberately never connect to the PASV data port, then issue LIST. Without
    // a bounded soTimeout on the passive ServerSocket, accept() blocks forever
    // and the client never receives a "150"/timeout response at all (HARD9-071).
    // This test proves the session terminates within a bounded window instead of
    // hanging - it does not wait out the full production timeout.
    writer.write("LIST\r\n")
    writer.flush()

    socket.soTimeout = 3_000
    try {
      reader.readLine()
    } catch (error: java.net.SocketTimeoutException) {
      fail(
              "Expected the FTP session to eventually close/respond once the data " +
                      "connection accept() times out, not hang past the client's own read timeout",
      )
    }

    socket.close()
    server.stop()
  }

  @Test
  fun ftpRejectsWrongPasswordWhenTokenConfigured() {
    val rootDir = tempFolder.newFolder("ftp-root-token")
    // A non-blank password (the per-boot token, HARD10-005) requires an exact
    // match — the isNullOrBlank() bypass only applies to the unauthenticated
    // null-password mode used by other tests.
    val server = MockFtpServer(rootDir, "boot-token")
    val port = server.start()

    val socket = Socket("127.0.0.1", port)
    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
    val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))

    assertTrue(reader.readLine().startsWith("220"))
    writer.write("USER user\r\n")
    writer.flush()
    assertTrue(reader.readLine().startsWith("331"))
    writer.write("PASS wrong\r\n")
    writer.flush()
    assertTrue("Wrong password must be rejected", reader.readLine().startsWith("530"))

    writer.write("PASS boot-token\r\n")
    writer.flush()
    assertTrue("Correct token must log in", reader.readLine().startsWith("230"))

    socket.close()
    server.stop()
  }

  @Test
  fun idleCommandConnectionIsReleasedBySocketReadTimeout() {
    val rootDir = tempFolder.newFolder("ftp-root7")
    val server = MockFtpServer(rootDir, null)
    // Without a command-socket read timeout, a client that connects and then
    // sends nothing parks a worker forever on reader.readLine() (HARD10-004 F2).
    server.commandSocketReadTimeoutMs = 200
    val port = server.start()

    val socket = Socket("127.0.0.1", port)
    socket.soTimeout = 3_000
    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))

    assertTrue(reader.readLine().startsWith("220"))
    // Deliberately send no command. The server's read timeout must fire and close
    // the connection (readLine returns null at EOF) within a bounded window rather
    // than hanging past the client's own read timeout.
    val next = reader.readLine()
    assertNull("Expected the server to close the idle command connection", next)

    socket.close()
    server.stop()
  }
}
