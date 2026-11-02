package app.awqat;

/**
 * The adhkar widget's choices, kept apart from Android so they can be tested on the JVM: which prayer day is under
 * way, and whether each set is said, open now, or later. The app gives each day's windows; nothing is worked out here.
 */
final class AdhkarData {
    static final int SAID = 0;
    static final int OPEN = 1;
    static final int LATER = 2;

    private AdhkarData() {}

    /** One prayer day's two sets: when each is open (milliseconds) and whether it is said in full. */
    static final class Day {
        final long morningFrom;
        final long morningTo;
        final boolean morningSaid;
        final long eveningFrom;
        final long eveningTo;
        final boolean eveningSaid;

        Day(long morningFrom, long morningTo, boolean morningSaid, long eveningFrom, long eveningTo, boolean eveningSaid) {
            this.morningFrom = morningFrom;
            this.morningTo = morningTo;
            this.morningSaid = morningSaid;
            this.eveningFrom = eveningFrom;
            this.eveningTo = eveningTo;
            this.eveningSaid = eveningSaid;
        }
    }

    /**
     * The day whose sets are shown: the last whose morning (Fajr) has come, else the first; -1 when there are none.
     * From the middle of the night both of its sets are over, so the next day's, still to come, are shown instead.
     */
    static int dayIndex(Day[] days, long now) {
        int found = days.length > 0 ? 0 : -1;
        for (int i = 0; i < days.length; i++) {
            if (days[i].morningFrom <= now) found = i;
        }
        if (found >= 0 && found + 1 < days.length && days[found].eveningTo <= now) found++;
        return found;
    }

    /** Said in full, open now, or later (still to open, or closed until its next day). */
    static int state(long from, long to, boolean said, long now) {
        if (said) return SAID;
        return now >= from && now < to ? OPEN : LATER;
    }

    /** The next moment a set opens or closes, or a new day starts; -1 when nothing is left. */
    static long nextChange(Day[] days, long now) {
        long best = Long.MAX_VALUE;
        for (Day day : days) {
            for (long t : new long[] {day.morningFrom, day.morningTo, day.eveningFrom, day.eveningTo}) {
                if (t > now && t < best) best = t;
            }
        }
        return best == Long.MAX_VALUE ? -1 : best;
    }
}
