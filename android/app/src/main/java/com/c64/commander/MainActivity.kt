package com.c64.commander

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(HvscIngestionPlugin::class.java)
    registerPlugin(FolderPickerPlugin::class.java)
    registerPlugin(MockC64UPlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
