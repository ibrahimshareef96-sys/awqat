package app.awqat;

/**
 * The widget's choices from its snapshot, kept apart from Android so they can be tested on the JVM: which prayer is
 * next, which day's line to show, and when the widget next has to be drawn again.
 */
final class TodayWidgetData {
    private TodayWidgetData() {}

    /** The soonest prayer still to come, or -1 when the snapshot has run out (the app was not opened for days). */
    static int nextPrayer(long[] at, long now) {
        int best = -1;
        for (int i = 0; i < at.length; i++) {
            if (at[i] > now && (best < 0 || at[i] < at[best])) best = i;
        }
        return best;
    }

    /**
     * The line for today's date (YYYY-MM-DD). Past the last day in the snapshot, the last day's line still holds: with
     * the app closed nothing is logged, so the revision left stays the same. Before the first day (a clock set back),
     * none: -1.
     */
    static int dayIndex(String[] dates, String today) {
        for (int i = 0; i < dates.length; i++) {
            if (today.equals(dates[i])) return i;
        }
        int last = dates.length - 1;
        return last >= 0 && !dates[last].isEmpty() && today.compareTo(dates[last]) > 0 ? last : -1;
    }

    /** The next moment the widget changes: the coming prayer or midnight, whichever is first. */
    static long nextChange(long[] at, long now, long nextMidnight) {
        int next = nextPrayer(at, now);
        return next < 0 ? nextMidnight : Math.min(at[next], nextMidnight);
    }

    /** A Chronometer's base for a wall-clock moment: it counts on elapsedRealtime, which a reboot sets back to zero. */
    static long chronometerBase(long at, long wallNow, long elapsedNow) {
        return elapsedNow + (at - wallNow);
    }

    /** A line cut to fit the widget, never null. */
    static String clip(String text, int max) {
        if (text == null) return "";
        if (text.length() <= max) return text;
        // Never half of an emoji, which would draw as a broken box.
        int end = max > 1 && Character.isHighSurrogate(text.charAt(max - 2)) ? max - 2 : max - 1;
        return text.substring(0, end) + "…";
    }
}
