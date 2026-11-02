package app.awqat;

/**
 * The agenda widget's choices, kept apart from Android so they can be tested on the JVM: which meeting is next, how its
 * day is named, and when the widget next changes. The app gives the meetings already sorted and cut to two days.
 */
final class AgendaData {
    static final int NOW = 0;
    static final int TODAY = 1;
    static final int TOMORROW = 2;
    static final int LATER = 3;

    private AgendaData() {}

    /** The first meeting not over yet: one under way, else the next to begin; -1 when there is none. */
    static int next(long[] start, long[] end, long now) {
        int found = -1;
        for (int i = 0; i < start.length; i++) {
            boolean ahead = end[i] > now;
            boolean sooner = found < 0 || start[i] < start[found];
            if (ahead && sooner) found = i;
        }
        return found;
    }

    /** Under way, today, tomorrow, or later; `today` and `tomorrow` are YYYY-MM-DD where the snapshot keeps time. */
    static int when(String date, String today, String tomorrow, long start, long end, long now) {
        if (start <= now && now < end) return NOW;
        if (date.equals(today)) return TODAY;
        if (date.equals(tomorrow)) return TOMORROW;
        return LATER;
    }

    /** The next moment it changes: a meeting that begins or ends, or midnight, when today and tomorrow move on. */
    static long nextChange(long[] start, long[] end, long now, long midnight) {
        long best = midnight > now ? midnight : Long.MAX_VALUE;
        for (int i = 0; i < start.length; i++) {
            if (start[i] > now && start[i] < best) best = start[i];
            if (end[i] > now && end[i] < best) best = end[i];
        }
        return best == Long.MAX_VALUE ? -1 : best;
    }
}
