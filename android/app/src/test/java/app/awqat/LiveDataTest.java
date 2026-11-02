package app.awqat;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.List;
import org.junit.Test;

/** What the live notifications and the dhikr counter decide, away from Android. */
public class LiveDataTest {
    private static final String FAITH = "awqat://go/faith";

    private static LiveData.Item dhikr(int count, int of) {
        return new LiveData.Item(LiveData.DHIKR, "Tasbih", count + " of " + of, 0L, 0L, count, of, "dhuhr|2026-11-01|tasbih",
                "awqat://go/mode:dhuhr");
    }

    private static LiveData.Item next(long endsAt) {
        return new LiveData.Item(LiveData.NEXT, "Asr", LiveData.IQAMA, endsAt, 0L, 0, 0, "", FAITH);
    }

    private static LiveData.Item timer(long startedAt) {
        return new LiveData.Item(LiveData.TIMER, "Trading", "Studying", 0L, startedAt, 0, 0, "", "awqat://go/mode:study:t-1");
    }

    @Test
    public void takesOnlyTheLinksTheAppFollows() {
        assertTrue(LiveData.isLink("awqat://go/modes"));
        assertTrue(LiveData.isLink("awqat://go/mode:study:ab-1"));
        assertFalse(LiveData.isLink("https://go/modes"));
        assertFalse(LiveData.isLink("awqat://go/"));
        assertFalse(LiveData.isLink("awqat://go/modes?x=1"));
        assertFalse(LiveData.isLink("awqat://go/a/b"));
        assertFalse(LiveData.isLink(null));
    }

    @Test
    public void takesNoLinkLongerThanTheAppCouldSend() {
        String prefix = "awqat://go/";
        assertTrue(LiveData.isLink(prefix + "mode:study:" + "a".repeat(64)));
        assertFalse(LiveData.isLink(prefix + "a".repeat(200)));
    }

    @Test
    public void anItemNeedsAnIdATitleAndALink() {
        assertTrue(dhikr(1, 3).isValid());
        assertTrue(next(5L).isValid());
        assertFalse(new LiveData.Item("other", "T", "D", 0L, 0L, 0, 0, "", FAITH).isValid());
        assertFalse(new LiveData.Item(LiveData.NEXT, " ", "D", 0L, 0L, 0, 0, "", FAITH).isValid());
        assertFalse(new LiveData.Item(LiveData.NEXT, "T", "D", 0L, 0L, 0, 0, "", "https://x").isValid());
    }

    @Test
    public void aDhikrCountsOnlyWithAKeyAndANumber() {
        assertTrue(dhikr(0, 3).counts());
        assertFalse(dhikr(0, 0).counts());
        assertFalse(new LiveData.Item(LiveData.DHIKR, "T", "D", 0L, 0L, 1, 3, "", FAITH).counts());
        assertFalse(new LiveData.Item(LiveData.TIMER, "T", "D", 0L, 0L, 1, 3, "k", FAITH).counts());
    }

    @Test
    public void addsPendingTapsAndStopsAtTheNumber() {
        assertEquals(12, LiveData.shownCount(12, 0, 100));
        assertEquals(15, LiveData.shownCount(12, 3, 100));
        assertEquals(100, LiveData.shownCount(99, 3, 100));
        assertEquals(100, LiveData.shownCount(150, 0, 100));
        assertEquals(0, LiveData.shownCount(-5, 0, 100));
        assertEquals(100, LiveData.shownCount(Integer.MAX_VALUE, Integer.MAX_VALUE, 100));
    }

    @Test
    public void aTapCountsOnlyBelowTheNumber() {
        assertTrue(LiveData.canTap(99, 100));
        assertFalse(LiveData.canTap(100, 100));
        assertFalse(LiveData.canTap(101, 100));
        assertFalse(LiveData.canTap(0, 0));
    }

    @Test
    public void tapsOnTheSameKeyAddUpWithoutTouchingTheOldList() {
        List<LiveData.Tap> none = Collections.emptyList();
        List<LiveData.Tap> one = LiveData.addTap(none, "a");
        List<LiveData.Tap> two = LiveData.addTap(one, "a");
        List<LiveData.Tap> three = LiveData.addTap(two, "b");
        assertEquals(0, none.size());
        assertEquals(1, one.get(0).n);
        assertEquals(1, two.size());
        assertEquals(2, two.get(0).n);
        assertEquals(2, three.size());
        assertEquals("b", three.get(1).key);
        assertEquals(2, LiveData.pendingFor(three, "a"));
        assertEquals(1, LiveData.pendingFor(three, "b"));
        assertEquals(0, LiveData.pendingFor(three, "c"));
    }

    @Test
    public void postsWhenNothingIsUpAndKeepsWhatIsAlreadyThere() {
        LiveData.Item item = next(1_000L);
        assertEquals(LiveData.Plan.POST, LiveData.plan(item, 0, 500L, null, ""));
        String up = LiveData.fingerprint(item, 0);
        assertEquals(LiveData.Plan.KEEP, LiveData.plan(item, 0, 500L, up, ""));
        assertEquals(LiveData.Plan.POST, LiveData.plan(next(2_000L), 0, 500L, up, ""));
    }

    @Test
    public void aCountThatHasNotMovedIsTheSameContent() {
        // The app's 15 after a drain looks the same as its 12 with three taps pending, so nothing flashes.
        LiveData.Item before = dhikr(12, 100);
        LiveData.Item after = dhikr(15, 100);
        String up = LiveData.fingerprint(before, LiveData.shownCount(12, 3, 100));
        assertEquals(LiveData.Plan.KEEP, LiveData.plan(after, 15, 500L, up, ""));
        assertEquals(LiveData.Plan.POST, LiveData.plan(after, 16, 500L, up, ""));
    }

    @Test
    public void aDismissedItemStaysAwayUntilItsContentChanges() {
        LiveData.Item item = next(1_000L);
        String gone = LiveData.identity(item);
        assertEquals(LiveData.Plan.SKIP, LiveData.plan(item, 0, 500L, null, gone));
        assertEquals(LiveData.Plan.POST, LiveData.plan(next(2_000L), 0, 500L, null, gone));
        assertEquals(LiveData.Plan.SKIP, LiveData.plan(timer(9L), 0, 500L, null, LiveData.identity(timer(9L))));
        assertEquals(LiveData.Plan.POST, LiveData.plan(timer(10L), 0, 500L, null, LiveData.identity(timer(9L))));
    }

    @Test
    public void countingOnDoesNotBringBackADismissedDhikr() {
        String gone = LiveData.identity(dhikr(12, 100));
        assertEquals(gone, LiveData.identity(dhikr(13, 100)));
        assertEquals(LiveData.Plan.SKIP, LiveData.plan(dhikr(13, 100), 13, 500L, null, gone));
    }

    @Test
    public void aDhikrAtItsNumberEndsItself() {
        assertEquals(LiveData.Plan.END, LiveData.plan(dhikr(100, 100), 100, 500L, null, ""));
        assertEquals(LiveData.Plan.END, LiveData.plan(dhikr(99, 100), 100, 500L, "up", ""));
    }

    @Test
    public void aCountdownAlreadyOverIsNotPosted() {
        assertEquals(LiveData.Plan.END, LiveData.plan(next(500L), 0, 500L, null, ""));
        assertEquals(LiveData.Plan.END, LiveData.plan(next(400L), 0, 500L, null, ""));
    }

    @Test
    public void fingerprintsDifferOnEveryShownField() {
        String base = LiveData.fingerprint(dhikr(1, 3), 1);
        assertNotEquals(base, LiveData.fingerprint(dhikr(1, 3), 2));
        assertNotEquals(base, LiveData.fingerprint(dhikr(1, 4), 1));
        assertNotEquals(LiveData.fingerprint(next(1L), 0), LiveData.fingerprint(next(2L), 0));
        assertNotEquals(LiveData.fingerprint(timer(1L), 0), LiveData.fingerprint(timer(2L), 0));
        // A separator inside a field cannot make two items look alike.
        LiveData.Item a = new LiveData.Item(LiveData.TIMER, "a", "b c", 0L, 0L, 0, 0, "", FAITH);
        LiveData.Item b = new LiveData.Item(LiveData.TIMER, "a b", "c", 0L, 0L, 0, 0, "", FAITH);
        assertNotEquals(LiveData.fingerprint(a, 0), LiveData.fingerprint(b, 0));
    }

    @Test
    public void whatGoesIntoThePrefsFileHoldsNoCharacterItsXmlCannotRead() {
        // &#0; in that file would make it unreadable, and with it the widget's snapshot and the pending taps.
        LiveData.Item odd = new LiveData.Item(LiveData.TIMER, "a\u0000b\u001f", "c\uD83D", 0L, 0L, 0, 0, "k\n", FAITH);
        for (String kept : new String[] {LiveData.fingerprint(odd, 0), LiveData.identity(odd), LiveData.identity(dhikr(1, 3))}) {
            for (int i = 0; i < kept.length(); i++) {
                assertFalse(Character.isISOControl(kept.charAt(i)) || Character.isSurrogate(kept.charAt(i)));
            }
        }
    }

    @Test
    public void theChipGetsAShortCountOrJustTheNumber() {
        assertEquals("12/100", LiveData.chipText(12, 100));
        assertEquals("1000", LiveData.chipText(1000, 3000));
        assertEquals("12 of 100", LiveData.countLine(12, 100));
    }

    @Test
    public void iqamaIsDueOnlyBetweenTheAdhanAndTheIqama() {
        long[] at = {1_000L, 5_000L, 9_000L};
        long[] iqama = {2_000L, 0L, 10_000L};
        assertEquals(-1, LiveData.iqamaDue(at, iqama, 999L));
        assertEquals(0, LiveData.iqamaDue(at, iqama, 1_000L));
        assertEquals(0, LiveData.iqamaDue(at, iqama, 1_999L));
        assertEquals(-1, LiveData.iqamaDue(at, iqama, 2_000L));
        // Jumu'ah has no iqama, so its prayer brings none, however close.
        assertEquals(-1, LiveData.iqamaDue(at, iqama, 5_001L));
        assertEquals(2, LiveData.iqamaDue(at, iqama, 9_500L));
        assertEquals(-1, LiveData.iqamaDue(at, iqama, 10_000L));
    }

    @Test
    public void onlyThePrayerThatJustCameCounts() {
        // An earlier prayer's iqama still ahead (bad data, or a very short gap) gives way to the later adhan.
        assertEquals(-1, LiveData.iqamaDue(new long[] {1_000L, 2_000L}, new long[] {3_000L, 0L}, 2_500L));
        // Out of order, the latest adhan still wins.
        assertEquals(0, LiveData.iqamaDue(new long[] {2_000L, 1_000L}, new long[] {3_000L, 4_000L}, 2_500L));
        assertEquals(-1, LiveData.iqamaDue(new long[0], new long[0], 2_500L));
    }

    @Test
    public void aShortIqamaListNeverThrows() {
        assertEquals(-1, LiveData.iqamaDue(new long[] {1_000L}, new long[0], 1_500L));
    }
}
