package uk.gleissner.deviceprobe;

/** Persistent, UI-independent capture state. Navigation keys never become test results. */
final class Wizard {
    static final String[] KEYS = {
        "Left soft key", "D-pad Up", "Right soft key",
        "Green Call", "D-pad Left", "Centre / OK", "D-pad Right", "Red Hang Up",
        "D-pad Down", "F1", "Special key", "F3",
        "1", "2 / ABC", "3 / DEF", "4 / GHI", "5 / JKL", "6 / MNO",
        "7 / PQRS", "8 / TUV", "9 / WXYZ", "*", "0", "#"
    };
    static final int TOTAL = KEYS.length * 2 + 5;
    int step;
    String phase = "armed";
    String outcome = "";
    String observed = "";
    int activeKey = -1;
    int repeats;
    int attempt;

    static boolean injected(int deviceId, int scanCode, int source) {
        return deviceId == -1 && scanCode == 0 && source == 0;
    }

    String label() {
        if (step < KEYS.length * 2) return KEYS[step % KEYS.length];
        if (step == KEYS.length * 2) return "Hold D-pad Up for two seconds";
        if (step == KEYS.length * 2 + 1) return "Hold D-pad Down for two seconds";
        if (step == KEYS.length * 2 + 2) return "Text: press 2 three times, wait, then 3 twice";
        if (step == KEYS.length * 2 + 3) return "Text: press Right soft key to delete";
        if (step == KEYS.length * 2 + 4) return "Text: press Centre / OK to finish";
        return "Capture complete";
    }
    String mode() { return step < KEYS.length ? "raw" : "web"; }
    /** An armed WebView step is only observable when the native WebView, not a button, has key focus. */
    boolean needsWebFocus() { return phase.equals("armed") && mode().equals("web"); }
    boolean textStep() { return step >= KEYS.length * 2 + 2 && step < TOTAL; }
    boolean disruptive() {
        return step < KEYS.length * 2 && (step % KEYS.length == 7 || step % KEYS.length == 10);
    }
    void down(int key, String description, int repeat) {
        if (!phase.equals("armed")) return;
        if (activeKey == -1) { activeKey = key; observed = description; }
        if (activeKey == key) repeats = Math.max(repeats, repeat);
    }
    void up(int key) {
        if (phase.equals("armed") && activeKey == key && !textStep()) review("event-received");
    }
    void webKey(String description, boolean released) {
        if (!phase.equals("armed") || textStep()) return;
        if (activeKey == -1) observed = description;
        if (released && activeKey == -1) review("dom-only-event");
    }
    void interrupted(String reason) {
        if (phase.equals("armed")) review(reason);
    }
    void review(String result) {
        phase = "review"; outcome = result;
    }
    void next() {
        if (!phase.equals("review")) return;
        step++;
        retry();
        if (step >= TOTAL) phase = "complete";
    }
    void retry() {
        attempt++;
        phase = "armed"; outcome = ""; observed = ""; activeKey = -1; repeats = 0;
    }
}
