package uk.gleissner.c64commander

import com.getcapacitor.BridgeActivity
import org.junit.Assert.assertTrue
import org.junit.Test
class MainActivityTest {
  @Test
  fun mainActivityIsBridgeActivity() {
    assertTrue(BridgeActivity::class.java.isAssignableFrom(MainActivity::class.java))
  }
}
