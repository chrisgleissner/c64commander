package com.c64.commander

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(HvscExtractorPlugin::class.java)
    registerPlugin(FolderPickerPlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
