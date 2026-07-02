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

  private fun recoverEncryptedPrefs(operation: String, error: Exception): Boolean {
    if (prefsProvider != null) return false
    Log.w(logTag, "Recovering encrypted preferences after $operation failed", error)
    AppLogger.warn(context, logTag, "Recovering encrypted preferences after $operation failed", "SecureStoragePlugin", error)
    synchronized(this) {
      cachedPrefs = null
      clearPrefsFile()
      deleteMasterKey()
    }
    return true
  }

  private fun clearPrefsFile() {
    try {
      val cleared = context.getSharedPreferences(prefsName, android.content.Context.MODE_PRIVATE).edit().clear().commit()
      if (!cleared) {
        AppLogger.warn(context, logTag, "Secure storage preferences clear did not confirm success", "SecureStoragePlugin")
      }
      val prefsDir = File(context.applicationInfo.dataDir, "shared_prefs")
      File(prefsDir, "$prefsName.xml").delete()
      File(prefsDir, "$prefsName.xml.bak").delete()
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
    try {
      getPrefs().edit().putString(passwordStorageKey, value).apply()
      call.resolve()
    } catch (error: Exception) {
      if (recoverEncryptedPrefs("set secure password", error)) {
        try {
          getPrefs().edit().putString(passwordStorageKey, value).apply()
          call.resolve()
          return
        } catch (retryError: Exception) {
          rejectWithLoggedError(call, "Failed to set secure password after recovery", retryError)
          return
        }
      }
      rejectWithLoggedError(call, "Failed to set secure password", error)
    }
  }

  @PluginMethod
  fun getPassword(call: PluginCall) {
    try {
      val value = getPrefs().getString(passwordStorageKey, null)
      val payload = JSObject()
      payload.put("value", value)
      call.resolve(payload)
    } catch (error: Exception) {
      if (recoverEncryptedPrefs("read secure password", error)) {
        val payload = JSObject()
        payload.put("value", null)
        call.resolve(payload)
        return
      }
      rejectWithLoggedError(call, "Failed to read secure password", error)
    }
  }

  @PluginMethod
  fun clearPassword(call: PluginCall) {
    try {
      getPrefs().edit().remove(passwordStorageKey).apply()
      call.resolve()
    } catch (error: Exception) {
      if (recoverEncryptedPrefs("clear secure password", error)) {
        call.resolve()
        return
      }
      rejectWithLoggedError(call, "Failed to clear secure password", error)
    }
  }
}
