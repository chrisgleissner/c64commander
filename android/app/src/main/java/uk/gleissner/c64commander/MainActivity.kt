/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(BackgroundExecutionPlugin::class.java)
    registerPlugin(FolderPickerPlugin::class.java)
    registerPlugin(MockC64UPlugin::class.java)
    registerPlugin(FeatureFlagsPlugin::class.java)
    registerPlugin(FtpClientPlugin::class.java)
    registerPlugin(SecureStoragePlugin::class.java)
    registerPlugin(DiagnosticsBridgePlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
