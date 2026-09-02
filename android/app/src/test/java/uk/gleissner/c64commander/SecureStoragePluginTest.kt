/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.any
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
class SecureStoragePluginTest {
  private lateinit var plugin: SecureStoragePlugin

  @Before
  fun setUp() {
    plugin = SecureStoragePlugin()
  }

  private fun setPluginBridge(target: SecureStoragePlugin, context: Context) {
    val bridge = mock(Bridge::class.java)
    org.mockito.Mockito.`when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  private fun memoryPrefs(context: Context, name: String) =
    context.getSharedPreferences(name, Context.MODE_PRIVATE).also {
      it.edit().clear().commit()
    }

  @Test
  fun setPasswordRejectsMissingValue() {
    val call = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(call.getString("value")).thenReturn(null)

    plugin.setPassword(call)

    verify(call).reject("value is required")
  }

  @Test
  fun setGetAndClearPassword() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.prefsProvider = {
      context.getSharedPreferences("secure-storage-plugin-test", Context.MODE_PRIVATE)
    }

    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    val setLatch = CountDownLatch(1)
    doAnswer {
      setLatch.countDown()
      null
    }.`when`(setCall).resolve()

    plugin.setPassword(setCall)
    assertTrue(setLatch.await(2, TimeUnit.SECONDS))

    val getCall = mock(PluginCall::class.java)
    val getLatch = CountDownLatch(1)
    var resolved: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      resolved = invocation.getArgument(0) as JSObject
      getLatch.countDown()
      null
    }.`when`(getCall).resolve(org.mockito.Mockito.any())

    plugin.getPassword(getCall)
    assertTrue(getLatch.await(2, TimeUnit.SECONDS))
    assertEquals("secret", resolved?.getString("value"))

    val clearCall = mock(PluginCall::class.java)
    val clearLatch = CountDownLatch(1)
    doAnswer {
      clearLatch.countDown()
      null
    }.`when`(clearCall).resolve()

    plugin.clearPassword(clearCall)
    assertTrue(clearLatch.await(2, TimeUnit.SECONDS))

    val getAfterClearCall = mock(PluginCall::class.java)
    val getAfterClearLatch = CountDownLatch(1)
    var clearedPayload: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      clearedPayload = invocation.getArgument(0) as JSObject
      getAfterClearLatch.countDown()
      null
    }.`when`(getAfterClearCall).resolve(org.mockito.Mockito.any())

    plugin.getPassword(getAfterClearCall)
    assertTrue(getAfterClearLatch.await(2, TimeUnit.SECONDS))
    assertEquals(null, clearedPayload?.getString("value"))
  }

  @Test
  fun encryptedPrefsFactoryIsSynchronizedAndCachedAcrossOperations() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    val prefs = memoryPrefs(context, "secure-storage-plugin-cache-test")
    var factoryCalls = 0
    plugin.encryptedPrefsFactory = {
      factoryCalls += 1
      prefs
    }

    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    plugin.setPassword(setCall)
    verify(setCall).resolve()

    val getCall = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      resolved = invocation.getArgument(0) as JSObject
      null
    }.`when`(getCall).resolve(org.mockito.Mockito.any())
    plugin.getPassword(getCall)

    val clearCall = mock(PluginCall::class.java)
    plugin.clearPassword(clearCall)
    verify(clearCall).resolve()

    assertEquals("secret", resolved?.getString("value"))
    assertEquals(1, factoryCalls)
  }

  @Test
  fun concurrentPasswordReadsShareOneEncryptedPrefsCreation() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    val prefs = memoryPrefs(context, "secure-storage-plugin-concurrent-cache-test")
    val factoryCalls = AtomicInteger(0)
    plugin.encryptedPrefsFactory = {
      factoryCalls.incrementAndGet()
      Thread.sleep(50)
      prefs
    }

    val workers = 6
    val executor = Executors.newFixedThreadPool(workers)
    val ready = CountDownLatch(workers)
    val start = CountDownLatch(1)
    val done = CountDownLatch(workers)
    repeat(workers) {
      executor.execute {
        ready.countDown()
        start.await(2, TimeUnit.SECONDS)
        plugin.getPassword(mock(PluginCall::class.java))
        done.countDown()
      }
    }

    assertTrue(ready.await(2, TimeUnit.SECONDS))
    start.countDown()
    assertTrue(done.await(2, TimeUnit.SECONDS))
    executor.shutdownNow()
    assertEquals(1, factoryCalls.get())
  }

  @Test
  fun setPasswordRetriesOnceWithoutWipingWhenTheFirstAttemptFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    val prefs = memoryPrefs(context, "secure-storage-plugin-recovery-test")
    var factoryCalls = 0
    plugin.encryptedPrefsFactory = {
      factoryCalls += 1
      if (factoryCalls == 1) throw RuntimeException("corrupt keyset")
      prefs
    }

    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    plugin.setPassword(setCall)

    verify(setCall).resolve()
    verify(setCall, never()).reject(any(), any(Exception::class.java))
    assertEquals(2, factoryCalls)
    assertEquals(0, plugin.recoveryCount)

    val getCall = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      resolved = invocation.getArgument(0) as JSObject
      null
    }.`when`(getCall).resolve(org.mockito.Mockito.any())
    plugin.getPassword(getCall)

    assertEquals("secret", resolved?.getString("value"))
    assertEquals(2, factoryCalls)
  }

  // HARD27-004: a read must never destroy the store. A read that keeps failing
  // rejects, so the TypeScript layer leaves passwordLoaded false and never
  // persists an empty envelope over the user's saved passwords.
  @Test
  fun getPasswordRejectsAndNeverWipesWhenEncryptedPrefsKeepFailing() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    plugin.encryptedPrefsFactory = { throw RuntimeException("corrupt keyset") }

    val getCall = mock(PluginCall::class.java)
    plugin.getPassword(getCall)

    verify(getCall).reject(any(), any(Exception::class.java))
    verify(getCall, never()).resolve(org.mockito.Mockito.any())
    assertEquals(0, plugin.recoveryCount)
  }

  // HARD27-004: androidx.security.crypto throws transiently when the Keystore
  // daemon restarts. One such failure must not cost the user every password.
  // The retry, not the exception class, is what tells the two cases apart.
  @Test
  fun getPasswordReturnsTheRealValueAfterOneFailedRead() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    val prefs = memoryPrefs(context, "secure-storage-plugin-transient-read-test")
    prefs.edit().putString("c64u_password", "stored-secret").commit()
    var factoryCalls = 0
    plugin.encryptedPrefsFactory = {
      factoryCalls += 1
      if (factoryCalls == 1) throw RuntimeException("keystore daemon restarted")
      prefs
    }

    val getCall = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      resolved = invocation.getArgument(0) as JSObject
      null
    }.`when`(getCall).resolve(org.mockito.Mockito.any())

    plugin.getPassword(getCall)

    assertEquals("stored-secret", resolved?.getString("value"))
    verify(getCall, never()).reject(any(), any(Exception::class.java))
    assertEquals(0, plugin.recoveryCount)
  }

  // HARD27-004: the write path retries before it wipes, so a password the user
  // just typed survives a single failure instead of costing the whole store.
  @Test
  fun setPasswordRetriesAFailedWriteWithoutWiping() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    val prefs = memoryPrefs(context, "secure-storage-plugin-transient-write-test")
    var factoryCalls = 0
    plugin.encryptedPrefsFactory = {
      factoryCalls += 1
      if (factoryCalls == 1) throw RuntimeException("keystore in use")
      prefs
    }

    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    plugin.setPassword(setCall)

    verify(setCall).resolve()
    verify(setCall, never()).reject(any(), any(Exception::class.java))
    assertEquals(0, plugin.recoveryCount)
    assertEquals("secret", prefs.getString("c64u_password", null))
  }

  // HARD27-004: genuine corruption still has a way out. Recovery runs only
  // after the retry also fails, and then exactly once.
  @Test
  fun setPasswordRecoversOnlyAfterTheRetryAlsoFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    val prefs = memoryPrefs(context, "secure-storage-plugin-persistent-corruption-test")
    var factoryCalls = 0
    plugin.encryptedPrefsFactory = {
      factoryCalls += 1
      if (factoryCalls <= 2) throw RuntimeException("corrupt keyset")
      prefs
    }

    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    plugin.setPassword(setCall)

    verify(setCall).resolve()
    assertEquals(3, factoryCalls)
    assertEquals(1, plugin.recoveryCount)
    assertEquals("secret", prefs.getString("c64u_password", null))
  }

  // HARD27-004: recovery renames the unreadable file rather than unlinking it,
  // so a support report can still show what was there.
  @Test
  fun recoveryQuarantinesTheCorruptPrefsFileInsteadOfDeletingIt() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    context.getSharedPreferences("c64_secure_storage", Context.MODE_PRIVATE)
      .edit().putString("opaque", "ciphertext").commit()
    val prefsDir = java.io.File(context.applicationInfo.dataDir, "shared_prefs")
    assertTrue(java.io.File(prefsDir, "c64_secure_storage.xml").exists())

    val prefs = memoryPrefs(context, "secure-storage-plugin-quarantine-test")
    var factoryCalls = 0
    plugin.encryptedPrefsFactory = {
      factoryCalls += 1
      if (factoryCalls <= 2) throw RuntimeException("corrupt keyset")
      prefs
    }
    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    plugin.setPassword(setCall)

    verify(setCall).resolve()
    val quarantined = prefsDir.listFiles { file ->
      file.name.startsWith("c64_secure_storage.xml.corrupt-")
    }
    assertEquals(1, quarantined?.size)
  }

  // HARD27-004: apply() flushes on a background thread, so a process death in
  // the flush window loses a password the app already reported as saved.
  @Test
  fun setPasswordCommitsSynchronously() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    val editor = mock(android.content.SharedPreferences.Editor::class.java)
    org.mockito.Mockito.`when`(editor.putString(org.mockito.Mockito.anyString(), org.mockito.Mockito.anyString()))
      .thenReturn(editor)
    org.mockito.Mockito.`when`(editor.remove(org.mockito.Mockito.anyString())).thenReturn(editor)
    org.mockito.Mockito.`when`(editor.commit()).thenReturn(true)
    val prefs = mock(android.content.SharedPreferences::class.java)
    org.mockito.Mockito.`when`(prefs.edit()).thenReturn(editor)
    plugin.prefsProvider = { prefs }

    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    plugin.setPassword(setCall)

    verify(setCall).resolve()
    verify(editor).commit()
    verify(editor, never()).apply()
  }

  @Test
  fun setPasswordRejectsWhenPrefsProviderFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    plugin.prefsProvider = { throw RuntimeException("prefs set failed") }

    val call = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(call.getString("value")).thenReturn("secret")

    plugin.setPassword(call)

    verify(call).reject(any(), any(Exception::class.java))
    verify(call, never()).resolve()
  }

  @Test
  fun getPasswordRejectsWhenPrefsProviderFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    plugin.prefsProvider = { throw RuntimeException("prefs get failed") }

    val call = mock(PluginCall::class.java)
    plugin.getPassword(call)

    verify(call).reject(any(), any(Exception::class.java))
    verify(call, never()).resolve(org.mockito.Mockito.any())
  }

  @Test
  fun clearPasswordRejectsWhenPrefsProviderFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.recoveryRetryDelayMs = 0L
    plugin.prefsProvider = { throw RuntimeException("prefs clear failed") }

    val call = mock(PluginCall::class.java)
    plugin.clearPassword(call)

    verify(call).reject(any(), any(Exception::class.java))
    verify(call, never()).resolve()
  }
}
