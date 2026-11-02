package app.awqat;

/**
 * The prayer day widget's choices from its snapshot, kept apart from Android so they can be tested on the JVM: which
 * prayer day is under way, which of its prayers is, which comes next, whose iqama to show, and when it next changes.
 * It only picks from the lists the app gave; nothing about prayers is worked out here (docs/live-surfaces.md).
 */
final class PrayerDayData {
    private PrayerDayData() {}

    /** One prayer day, Fajr to Fajr. Times are milliseconds; an `until` or `iqama` of 0 means it has none. */
    static final class Day {
        final String hijri;
        final String[] names;
        final String[] times;
        final long[] at;
        final long[] until;
        final long[] iqama;
        final String[] iqamaTimes;

        Day(String hijri, String[] names, String[] times, long[] at, long[] until, long[] iqama, String[] iqamaTimes) {
            this.hijri = hijri;
            this.names = names;
            this.times = times;
            this.at = at;
            this.until = until;
            this.iqama = iqama;
            this.iqamaTimes = iqamaTimes;
        }
    }

    /** A prayer on the lists: its day, and its place in that day. */
    static final class Pick {
        final int day;
        final int prayer;

        Pick(int day, int prayer) {
            this.day = day;
            this.prayer = prayer;
        }
    }

    /** The day under way: the last whose first prayer has come, else the first; -1 when there are none. */
    static int dayIndex(Day[] days, long now) {
        int found = days.length > 0 ? 0 : -1;
        for (int i = 0; i < days.length; i++) {
            if (days[i].at.length > 0 && days[i].at[0] <= now) found = i;
        }
        return found;
    }

    /** The prayer whose time has come and is not over yet, or -1 (between sunrise and Dhuhr none is). */
    static int current(Day day, long now) {
        int found = -1;
        for (int i = 0; i < day.at.length; i++) {
            if (day.at[i] <= now && (day.until[i] == 0 || now < day.until[i])) found = i;
        }
        return found;
    }

    /** The soonest prayer still to come on any day, or null when the snapshot has run out. */
    static Pick next(Day[] days, long now) {
        Pick best = null;
        long bestAt = Long.MAX_VALUE;
        for (int d = 0; d < days.length; d++) {
            for (int p = 0; p < days[d].at.length; p++) {
                if (days[d].at[p] > now && days[d].at[p] < bestAt) {
                    best = new Pick(d, p);
                    bestAt = days[d].at[p];
                }
            }
        }
        return best;
    }

    /**
     * The iqama to show: the prayer under way's while it is still ahead, else the next prayer's; null when neither has
     * one (Jumu'ah has none).
     */
    static Pick iqama(Day[] days, int day, int current, Pick next, long now) {
        if (day >= 0 && current >= 0 && days[day].iqama[current] > now) return new Pick(day, current);
        if (next != null && days[next.day].iqama[next.prayer] > now) return next;
        return null;
    }

    /** The next moment anything shown changes: a prayer that comes or ends, or an iqama; -1 when nothing is left. */
    static long nextChange(Day[] days, long now) {
        long best = Long.MAX_VALUE;
        for (Day day : days) {
            for (int i = 0; i < day.at.length; i++) {
                best = soonest(best, day.at[i], now);
                best = soonest(best, day.until[i], now);
                best = soonest(best, day.iqama[i], now);
            }
        }
        return best == Long.MAX_VALUE ? -1 : best;
    }

    private static long soonest(long best, long candidate, long now) {
        return candidate > now && candidate < best ? candidate : best;
    }

    /** A Chronometer's format with a name in it: a "%" in the name is kept as text, never read as a format. */
    static String countdownFormat(String name, String word) {
        return name.replace("%", "%%") + " " + word + " %s";
    }
}
