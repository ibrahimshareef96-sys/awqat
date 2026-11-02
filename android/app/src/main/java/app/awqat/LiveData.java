package app.awqat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * What the live notifications and the dhikr counter decide, kept apart from Android so it can be tested on the JVM:
 * whether a show posts anything, what a tap adds up to, and which iqama is coming. No prayer logic beyond picking from
 * the list the app gave (docs/live-surfaces.md).
 */
final class LiveData {
    static final String NEXT = "next";
    static final String DHIKR = "dhikr";
    static final String TIMER = "timer";
    /** The words and the link the app's own "next" item uses, so the two are the same content and never flash. */
    static final String IQAMA = "Iqama";
    static final String FAITH_LINK = "awqat://go/faith";

    /** The same shape the app's linkTarget accepts. */
    private static final Pattern LINK = Pattern.compile("awqat://go/[A-Za-z0-9:-]+");
    /** The longest the app sends is about 90 ("mode:study:" and a 64-character track). */
    private static final int LINK_MAX = 128;
    /** Below this many characters the status-bar chip shows a text whole. */
    private static final int CHIP_MAX = 7;

    enum Plan { POST, KEEP, SKIP, END }

    private LiveData() {}

    /** One thing on the lock screen. Times are milliseconds, 0 when absent; `of` is 0 when nothing is being counted. */
    static final class Item {
        final String id;
        final String title;
        final String detail;
        final long endsAt;
        final long startedAt;
        final int count;
        final int of;
        final String key;
        final String link;

        Item(String id, String title, String detail, long endsAt, long startedAt, int count, int of, String key, String link) {
            this.id = id;
            this.title = title;
            this.detail = detail;
            this.endsAt = endsAt;
            this.startedAt = startedAt;
            this.count = count;
            this.of = of;
            this.key = key;
            this.link = link;
        }

        boolean isValid() {
            return isId(id) && title != null && !title.trim().isEmpty() && isLink(link);
        }

        /** A dhikr with something to count towards: it gets a number, a bar and a "+1". */
        boolean counts() {
            return DHIKR.equals(id) && of > 0 && key != null && !key.isEmpty();
        }
    }

    /** Taps made with the app closed, waiting for it to take them. */
    static final class Tap {
        final String key;
        final int n;

        Tap(String key, int n) {
            this.key = key;
            this.n = n;
        }
    }

    static boolean isId(String id) {
        return NEXT.equals(id) || DHIKR.equals(id) || TIMER.equals(id);
    }

    static boolean isLink(String link) {
        return link != null && link.length() <= LINK_MAX && LINK.matcher(link).matches();
    }

    /** The count on screen: the app's, plus what was tapped since it last looked, never past the number. */
    static int shownCount(int count, int pending, int of) {
        long sum = Math.max(0L, (long) count + Math.max(0, pending));
        return (int) Math.min(sum, Math.max(0, of));
    }

    static boolean canTap(int shown, int of) {
        return of > 0 && shown < of;
    }

    static List<Tap> addTap(List<Tap> taps, String key) {
        List<Tap> next = new ArrayList<>(taps.size() + 1);
        boolean found = false;
        for (Tap tap : taps) {
            boolean same = tap.key.equals(key);
            found |= same;
            next.add(same ? new Tap(key, tap.n + 1) : tap);
        }
        if (!found) next.add(new Tap(key, 1));
        return Collections.unmodifiableList(next);
    }

    static int pendingFor(List<Tap> taps, String key) {
        int sum = 0;
        for (Tap tap : taps) {
            if (tap.key.equals(key)) sum += tap.n;
        }
        return sum;
    }

    /**
     * What a dismissal is remembered by. A dhikr goes by its key alone: the count moves with every tap in the app, and a
     * card the user swiped away must not come back on the next one.
     */
    static String identity(Item item) {
        if (DHIKR.equals(item.id) && item.key != null && !item.key.isEmpty()) return join(item.id, item.key);
        return join(item.id, item.title, item.detail, Long.toString(item.endsAt), Long.toString(item.startedAt));
    }

    /** Everything the card shows: the same fingerprint means there is nothing to post. */
    static String fingerprint(Item item, int shown) {
        String count = item.counts() ? shown + "/" + item.of : "";
        String detail = item.counts() ? "" : item.detail;
        return join(item.id, item.title, detail, Long.toString(item.endsAt), Long.toString(item.startedAt), count, item.key, item.link);
    }

    /**
     * What a show does. `up` is the fingerprint of the card on screen (null when none is), `dismissed` the identity the user
     * last swiped away ("" when none).
     */
    static Plan plan(Item item, int shown, long now, String up, String dismissed) {
        if (item.counts() && !canTap(shown, item.of)) return Plan.END;
        if (item.endsAt > 0 && item.endsAt <= now) return Plan.END;
        if (identity(item).equals(dismissed)) return Plan.SKIP;
        return fingerprint(item, shown).equals(up) ? Plan.KEEP : Plan.POST;
    }

    static String countLine(int shown, int of) {
        return shown + " of " + of;
    }

    /** The status-bar chip's text: "12/100", or the number alone when that would be cut. */
    static String chipText(int shown, int of) {
        String both = shown + "/" + of;
        return both.length() < CHIP_MAX ? both : Integer.toString(shown);
    }

    /**
     * The prayer that has just come, when its iqama is still ahead, else -1. Only the latest adhan counts: once a later
     * prayer has come, an earlier iqama is not what is under way.
     */
    static int iqamaDue(long[] at, long[] iqama, long now) {
        int last = -1;
        for (int i = 0; i < at.length; i++) {
            if (at[i] <= now && (last < 0 || at[i] > at[last])) last = i;
        }
        return last >= 0 && last < iqama.length && iqama[last] > now ? last : -1;
    }

    /**
     * Each part with its length, so that two different items can never join up into the same text. Control characters
     * are spelt out: these strings go into a SharedPreferences XML file, which cannot read itself back with them in it,
     * and a file that cannot be read loses the snapshot too.
     */
    private static String join(String... parts) {
        StringBuilder out = new StringBuilder();
        for (String part : parts) {
            String text = part == null ? "" : part;
            out.append(text.length()).append(':');
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (Character.isISOControl(c) || Character.isSurrogate(c)) out.append(String.format("\\u%04x", (int) c));
                else out.append(c);
            }
        }
        return out.toString();
    }
}
