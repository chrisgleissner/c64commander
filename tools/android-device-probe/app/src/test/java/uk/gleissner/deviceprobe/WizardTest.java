package uk.gleissner.deviceprobe;

import org.junit.Test;
import static org.junit.Assert.*;

public class WizardTest {
    @Test public void injectedDpadPressCannotBeMistakenForThePromptedPhysicalKey() {
        assertTrue(Wizard.injected(-1, 0, 0));
        assertFalse(Wizard.injected(2, 139, 769));
        assertFalse(Wizard.injected(2, 0, 769));
        assertFalse(Wizard.injected(-1, 0, 769));
    }
    @Test public void namesPhysicalKeysInReadingOrderIncludingSystemKeys() {
        Wizard wizard = new Wizard();
        assertEquals("Left soft key", wizard.label());
        wizard.step = 7; assertEquals("Red Hang Up", wizard.label()); assertTrue(wizard.disruptive());
        wizard.step = 10; assertEquals("Special key", wizard.label()); assertTrue(wizard.disruptive());
        wizard.step = 23; assertEquals("#", wizard.label());
        wizard.step = 24; assertEquals("Left soft key", wizard.label()); assertEquals("web", wizard.mode());
    }
    @Test public void releaseReviewsCapturedKeyWithoutAdvancingPhysicalPrompt() {
        Wizard wizard = new Wizard();
        wizard.down(82, "KEYCODE_MENU scan=139", 0); wizard.up(82);
        assertEquals(0, wizard.step); assertEquals("review", wizard.phase);
        assertEquals("KEYCODE_MENU scan=139", wizard.observed);
        wizard.down(23, "OK confirmation", 0); wizard.up(23);
        assertEquals("KEYCODE_MENU scan=139", wizard.observed);
        wizard.next(); assertEquals(1, wizard.step); assertEquals("", wizard.observed);
    }
    @Test public void screenOffWithoutAnyAndroidEventRemainsAssociatedWithHangUp() {
        Wizard wizard = new Wizard(); wizard.step = 7;
        wizard.interrupted("screen-off");
        assertEquals(7, wizard.step); assertEquals("Red Hang Up", wizard.label());
        assertEquals("screen-off", wizard.outcome); assertEquals("", wizard.observed);
        wizard.interrupted("foreground-lost"); assertEquals("screen-off", wizard.outcome);
        wizard.next(); assertEquals("D-pad Down", wizard.label());
    }
    @Test public void foregroundLossWithMissingReleasePreservesCandidateUntilRetry() {
        Wizard wizard = new Wizard(); wizard.step = 10;
        wizard.down(3, "HOME", 0); wizard.interrupted("foreground-lost");
        assertEquals("HOME", wizard.observed); assertEquals(10, wizard.step);
        wizard.retry(); assertEquals(-1, wizard.activeKey); assertEquals("armed", wizard.phase);
        assertEquals(10, wizard.step);
    }
    @Test public void domOnlyFunctionKeyCompletesTheNamedAttempt() {
        Wizard wizard = new Wizard(); wizard.step = 33;
        wizard.webKey("F21 / F21", false); wizard.webKey("F21 / F21", true);
        assertEquals("F1", wizard.label()); assertEquals("dom-only-event", wizard.outcome);
    }
    @Test public void holdAccumulatesRepeatsUntilMatchingRelease() {
        Wizard wizard = new Wizard(); wizard.step = 48;
        wizard.down(19, "UP", 0); wizard.down(19, "UP", 30); wizard.up(20);
        assertEquals("armed", wizard.phase); wizard.up(19);
        assertEquals(30, wizard.repeats); assertEquals("review", wizard.phase);
    }
    @Test public void textEntryDoesNotAdvanceOnEachCharacter() {
        Wizard wizard = new Wizard(); wizard.step = 50;
        wizard.down(9, "2", 0); wizard.up(9); wizard.webKey("a", true);
        assertEquals("armed", wizard.phase); assertEquals(50, wizard.step);
        wizard.review("text-attempt-confirmed"); wizard.next(); assertEquals(51, wizard.step);
    }
    @Test public void nextCannotSkipArmedAttemptAndCompletionHasNoFurtherPhysicalKey() {
        Wizard wizard = new Wizard(); wizard.next(); assertEquals(0, wizard.step);
        wizard.step = Wizard.TOTAL - 1; wizard.review("text-attempt-confirmed"); wizard.next();
        assertEquals("complete", wizard.phase); assertEquals("Capture complete", wizard.label());
        wizard.next(); assertEquals(Wizard.TOTAL, wizard.step);
    }
    @Test public void armedWebViewStepNeedsNativeWebViewFocusButPhysicalAndReviewStepsDoNot() {
        Wizard wizard = new Wizard();
        assertFalse(wizard.needsWebFocus());
        wizard.step = 33; assertTrue(wizard.needsWebFocus());
        wizard.review("event-received"); assertFalse(wizard.needsWebFocus());
        wizard.retry(); assertTrue(wizard.needsWebFocus());
    }
    @Test public void everyRetryIsANewAttemptSoThePageRefocusesItsTarget() {
        Wizard wizard = new Wizard(); wizard.step = 33;
        int first = wizard.attempt;
        wizard.retry(); assertEquals(first + 1, wizard.attempt);
        wizard.review("event-received"); wizard.next(); assertEquals(first + 2, wizard.attempt);
    }
}
