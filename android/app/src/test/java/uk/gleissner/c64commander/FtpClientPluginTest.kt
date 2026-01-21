package uk.gleissner.c64commander

import com.getcapacitor.PluginCall
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.*

class FtpClientPluginTest {
  private lateinit var plugin: FtpClientPlugin

  @Before
  fun setUp() {
    plugin = FtpClientPlugin()
  }

  @Test
  fun listDirectoryRejectsWhenHostIsMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn(null)

    plugin.listDirectory(call)

    verify(call).reject("host is required")
    verify(call, never()).resolve(any())
  }

  @Test
  fun listDirectoryRejectsWhenHostIsBlank() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("")

    plugin.listDirectory(call)

    verify(call).reject("host is required")
    verify(call, never()).resolve(any())
  }

  @Test
  fun buildPathHandlesTrailingSlash() {
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "buildPath",
      String::class.java,
      String::class.java
    )
    method.isAccessible = true

    val result = method.invoke(plugin, "/folder/", "file.txt") as String
    assertEquals("/folder/file.txt", result)
  }

  @Test
  fun buildPathHandlesNoTrailingSlash() {
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "buildPath",
      String::class.java,
      String::class.java
    )
    method.isAccessible = true

    val result = method.invoke(plugin, "/folder", "file.txt") as String
    assertEquals("/folder/file.txt", result)
  }

  @Test
  fun buildPathHandlesEmptyBase() {
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "buildPath",
      String::class.java,
      String::class.java
    )
    method.isAccessible = true

    val result = method.invoke(plugin, "", "file.txt") as String
    assertEquals("/file.txt", result)
  }

  @Test
  fun buildPathHandlesRootBase() {
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "buildPath",
      String::class.java,
      String::class.java
    )
    method.isAccessible = true

    val result = method.invoke(plugin, "/", "file.txt") as String
    assertEquals("/file.txt", result)
  }
}
