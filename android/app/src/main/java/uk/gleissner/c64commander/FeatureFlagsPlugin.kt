/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Context.featureFlagsDataStore by preferencesDataStore(name = "feature_flags")

@CapacitorPlugin(name = "FeatureFlags")
class FeatureFlagsPlugin : Plugin() {
  private val scope = CoroutineScope(Dispatchers.IO)
  private val logTag = "FeatureFlagsPlugin"

  @PluginMethod
  fun getFlag(call: PluginCall) {
    val key = call.getString("key")
    if (key.isNullOrBlank()) {
      call.reject("key is required")
      return
    }

    scope.launch {
      try {
        val prefs = context.featureFlagsDataStore.data.first()
        val value = prefs[booleanPreferencesKey(key)]
        val payload = JSObject()
        if (value != null) {
          payload.put("value", value)
        }
        withContext(Dispatchers.Main) {
          call.resolve(payload)
        }
      } catch (error: Exception) {
        Log.e(logTag, "Failed to get feature flag", error)
        withContext(Dispatchers.Main) {
          call.reject(error.message, error)
        }
      }
    }
  }

  @PluginMethod
  fun setFlag(call: PluginCall) {
    val key = call.getString("key")
    val value = call.getBoolean("value")
    if (key.isNullOrBlank()) {
      call.reject("key is required")
      return
    }
    if (value == null) {
      call.reject("value is required")
      return
    }

    scope.launch {
      try {
        context.featureFlagsDataStore.edit { prefs ->
          prefs[booleanPreferencesKey(key)] = value
        }
        withContext(Dispatchers.Main) {
          call.resolve()
        }
      } catch (error: Exception) {
        Log.e(logTag, "Failed to set feature flag", error)
        withContext(Dispatchers.Main) {
          call.reject(error.message, error)
        }
      }
    }
  }

  @PluginMethod
  fun getAllFlags(call: PluginCall) {
    val keysArray: JSArray? = call.getArray("keys")
    val keys = mutableListOf<String>()
    if (keysArray != null) {
      for (index in 0 until keysArray.length()) {
        keysArray.getString(index)?.let { keys.add(it) }
      }
    }

    scope.launch {
      try {
        val prefs = context.featureFlagsDataStore.data.first()
        val flags = JSObject()
        keys.forEach { key ->
          val value = prefs[booleanPreferencesKey(key)]
          if (value != null) {
            flags.put(key, value)
          }
        }
        val payload = JSObject()
        payload.put("flags", flags)
        withContext(Dispatchers.Main) {
          call.resolve(payload)
        }
      } catch (error: Exception) {
        Log.e(logTag, "Failed to get feature flags", error)
        withContext(Dispatchers.Main) {
          call.reject(error.message, error)
        }
      }
    }
  }
}
