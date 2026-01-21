package uk.gleissner.c64commander

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.PluginCall
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.*

class FolderPickerPluginTest {
  private lateinit var plugin: FolderPickerPlugin

  @Before
  fun setUp() {
    plugin = FolderPickerPlugin()
  }

  @Test
  fun readFileRejectsWhenUriIsMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn(null)

    plugin.readFile(call)

    // Give executor time to run
    Thread.sleep(100)

    verify(call).reject("uri is required")
  }

  @Test
  fun readFileRejectsWhenUriIsBlank() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn("")

    plugin.readFile(call)

    // Give executor time to run
    Thread.sleep(100)

    verify(call).reject("uri is required")
  }
}
