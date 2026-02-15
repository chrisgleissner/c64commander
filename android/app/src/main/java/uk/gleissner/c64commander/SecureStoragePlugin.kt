/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SecureStorage")
class SecureStoragePlugin : Plugin() {
  private val prefsName = "c64_secure_storage"
  private val passwordStorageKey = "c64u_password"
  private val logTag = "SecureStoragePlugin"

  private fun getPrefs() = EncryptedSharedPreferences.create(
    context,
    prefsName,
    MasterKey.Builder(context)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
  )

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
      Log.e(logTag, "Failed to set secure password", error)
      AppLogger.error(context, logTag, "Failed to set secure password", "SecureStoragePlugin", error)
      call.reject(error.message, error)
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
      Log.e(logTag, "Failed to read secure password", error)
      AppLogger.error(context, logTag, "Failed to read secure password", "SecureStoragePlugin", error)
      call.reject(error.message, error)
    }
  }

  @PluginMethod
  fun clearPassword(call: PluginCall) {
    try {
      getPrefs().edit().remove(passwordStorageKey).apply()
      call.resolve()
    } catch (error: Exception) {
      Log.e(logTag, "Failed to clear secure password", error)
      AppLogger.error(context, logTag, "Failed to clear secure password", "SecureStoragePlugin", error)
      call.reject(error.message, error)
    }
  }
}
