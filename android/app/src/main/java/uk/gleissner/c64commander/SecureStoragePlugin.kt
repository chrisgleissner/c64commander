/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.security.KeyStore

@CapacitorPlugin(name = "SecureStorage")
class SecureStoragePlugin : Plugin() {
  private val prefsName = "c64_secure_storage"
  private val passwordStorageKey = "c64u_password"
  private val logTag = "SecureStoragePlugin"
  private var cachedPrefs: SharedPreferences? = null
  internal var prefsProvider: (() -> SharedPreferences)? = null
  internal var encryptedPrefsFactory: (() -> SharedPreferences)? = null
  internal var recoveryRetryDelayMs: Long = 50L
  internal var recoveryCount = 0

  @Synchronized
  private fun getPrefs(): SharedPreferences {
    prefsProvider?.let { return it() }
    cachedPrefs?.let { return it }
    val prefs = encryptedPrefsFactory?.invoke() ?: EncryptedSharedPreferences.create(
      context,
      prefsName,
      MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build(),
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    cachedPrefs = prefs
    return prefs
  }

  private fun rejectWithLoggedError(call: PluginCall, message: String, error: Exception) {
    Log.e(logTag, message, error)
    AppLogger.error(context, logTag, message, "SecureStoragePlugin", error)
    call.reject(error.message, error)
  }

  // A fresh EncryptedSharedPreferences after a short pause distinguishes a
  // transient failure, which passes, from genuine corruption, which does not.
  private fun retryPrefs(): SharedPreferences {
    synchronized(this) { cachedPrefs = null }
    if (recoveryRetryDelayMs > 0L) {
      try {
        Thread.sleep(recoveryRetryDelayMs)
      } catch (interrupted: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    return getPrefs()
  }

  private fun writePassword(prefs: SharedPreferences, value: String?) {
    val editor = prefs.edit()
    if (value == null) editor.remove(passwordStorageKey) else editor.putString(passwordStorageKey, value)
    // commit() rather than apply(): apply() flushes on a background thread, so
    // a process death in that window loses a password already reported as saved.
    if (!editor.commit()) throw PrefsWriteFailure("Secure storage write did not confirm success")
  }

  private fun readPayload(prefs: SharedPreferences): JSObject {
    val payload = JSObject()
    payload.put("value", prefs.getString(passwordStorageKey, null))
    return payload
  }

  private class PrefsWriteFailure(message: String) : Exception(message)

  private fun recoverEncryptedPrefs(operation: String, error: Exception): Boolean {
    // A write that reported failure is a storage-layer failure, not a corrupt
    // keyset: wiping cannot fix it and would discard the other devices' passwords.
    if (error is PrefsWriteFailure) return false
    if (prefsProvider != null) return false
    Log.w(logTag, "Recovering encrypted preferences after $operation failed", error)
    AppLogger.warn(context, logTag, "Recovering encrypted preferences after $operation failed", "SecureStoragePlugin", error)
    synchronized(this) {
      recoveryCount += 1
      cachedPrefs = null
      clearPrefsFile()
      deleteMasterKey()
    }
    return true
  }

  // Renames the unreadable file to a .corrupt-<timestamp> sibling before
  // clearing, so a support report can still show what was there. Exactly one
  // such copy is kept, and its contents stay encrypted under a deleted key.
  private fun clearPrefsFile() {
    try {
      val prefsDir = File(context.applicationInfo.dataDir, "shared_prefs")
      val quarantinePrefix = "$prefsName.xml.corrupt-"
      prefsDir.listFiles { file -> file.name.startsWith(quarantinePrefix) }?.forEach { it.delete() }
      val prefsFile = File(prefsDir, "$prefsName.xml")
      if (prefsFile.exists() && !prefsFile.renameTo(File(prefsDir, "$quarantinePrefix${System.currentTimeMillis()}"))) {
        prefsFile.delete()
      }
      File(prefsDir, "$prefsName.xml.bak").delete()
      val cleared = context.getSharedPreferences(prefsName, android.content.Context.MODE_PRIVATE).edit().clear().commit()
      if (!cleared) {
        AppLogger.warn(context, logTag, "Secure storage preferences clear did not confirm success", "SecureStoragePlugin")
      }
    } catch (error: Exception) {
      Log.w(logTag, "Failed to clear encrypted preferences file during recovery", error)
      AppLogger.warn(
        context,
        logTag,
        "Failed to clear encrypted preferences file during recovery",
        "SecureStoragePlugin",
        error,
      )
    }
  }

  private fun deleteMasterKey() {
    try {
      val keyStore = KeyStore.getInstance("AndroidKeyStore")
      keyStore.load(null)
      if (keyStore.containsAlias(MasterKey.DEFAULT_MASTER_KEY_ALIAS)) {
        keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
      }
    } catch (error: Exception) {
      Log.w(logTag, "Failed to delete secure-storage master key during recovery", error)
      AppLogger.warn(
        context,
        logTag,
        "Failed to delete secure-storage master key during recovery",
        "SecureStoragePlugin",
        error,
      )
    }
  }

  @PluginMethod
  fun setPassword(call: PluginCall) {
    val value = call.getString("value")
    if (value == null) {
      call.reject("value is required")
      return
    }
    writeWithRecovery(call, "set secure password", value)
  }

  // HARD27-004: a failed write retries against a fresh store first. Only a
  // second failure is treated as corruption, and only then is the store wiped.
  private fun writeWithRecovery(call: PluginCall, operation: String, value: String?) {
    try {
      writePassword(getPrefs(), value)
      call.resolve()
      return
    } catch (error: Exception) {
      try {
        writePassword(retryPrefs(), value)
        call.resolve()
        return
      } catch (retryError: Exception) {
        if (!recoverEncryptedPrefs(operation, retryError)) {
          rejectWithLoggedError(call, "Failed to $operation", retryError)
          return
        }
        try {
          writePassword(getPrefs(), value)
          call.resolve()
        } catch (recoveredError: Exception) {
          rejectWithLoggedError(call, "Failed to $operation after recovery", recoveredError)
        }
      }
    }
  }

  @PluginMethod
  fun getPassword(call: PluginCall) {
    // HARD27-004: a read never wipes the store. Resolving null after a failed
    // read makes the TypeScript layer cache "no passwords" and persist that
    // empty set over the user's saved ones, so a read that keeps failing
    // rejects instead and leaves the stored passwords alone.
    try {
      call.resolve(readPayload(getPrefs()))
      return
    } catch (error: Exception) {
      try {
        call.resolve(readPayload(retryPrefs()))
      } catch (retryError: Exception) {
        rejectWithLoggedError(call, "Failed to read secure password", retryError)
      }
    }
  }

  @PluginMethod
  fun clearPassword(call: PluginCall) {
    writeWithRecovery(call, "clear secure password", null)
  }
}
