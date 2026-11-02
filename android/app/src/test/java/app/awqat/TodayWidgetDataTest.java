package app.awqat;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The widget picks the next prayer, today's line and its next redraw from the snapshot the app gave it. */
public class TodayWidgetDataTest {
    private static final long[] AT = {1_000L, 2_000L, 3_000L};

    @Test
    public void picksTheSoonestPrayerStillToCome() {
        assertEquals(0, TodayWidgetData.nextPrayer(AT, 999L));
        assertEquals(1, TodayWidgetData.nextPrayer(AT, 1_000L));
        // Out of order, the soonest still wins.
        assertEquals(1, TodayWidgetData.nextPrayer(new long[] {3_000L, 2_500L, 900L}, 1_000L));
    }

    @Test
    public void saysWhenTheSnapshotHasRunOut() {
        assertEquals(-1, TodayWidgetData.nextPrayer(AT, 3_000L));
        assertEquals(-1, TodayWidgetData.nextPrayer(new long[0], 0L));
    }

    @Test
    public void findsTodaysLine() {
        String[] dates = {"2026-10-24", "2026-10-25"};
        assertEquals(0, TodayWidgetData.dayIndex(dates, "2026-10-24"));
        assertEquals(1, TodayWidgetData.dayIndex(dates, "2026-10-25"));
    }

    @Test
    public void keepsTheLastDaysLineWhileTheAppStaysClosed() {
        String[] dates = {"2026-10-24", "2026-10-25"};
        assertEquals(1, TodayWidgetData.dayIndex(dates, "2026-10-28"));
        assertEquals(-1, TodayWidgetData.dayIndex(dates, "2026-10-20"));
        assertEquals(-1, TodayWidgetData.dayIndex(new String[0], "2026-10-24"));
        // A date the widget could not read is never taken for the last day.
        assertEquals(-1, TodayWidgetData.dayIndex(new String[] {"2026-10-24", ""}, "2026-10-28"));
    }

    @Test
    public void redrawsAtTheNextPrayerOrMidnight() {
        assertEquals(2_000L, TodayWidgetData.nextChange(AT, 1_500L, 9_000L));
        assertEquals(1_800L, TodayWidgetData.nextChange(AT, 1_500L, 1_800L));
        assertEquals(9_000L, TodayWidgetData.nextChange(AT, 5_000L, 9_000L));
    }

    @Test
    public void setsTheCountdownsBaseOnTheClockThatSurvivesAClockChange() {
        // 90 seconds ahead on the wall clock, from an uptime of 5,000 ms.
        assertEquals(95_000L, TodayWidgetData.chronometerBase(1_090_000L, 1_000_000L, 5_000L));
        // A time already past gives a base behind the uptime, never a crash.
        assertEquals(4_000L, TodayWidgetData.chronometerBase(999_000L, 1_000_000L, 5_000L));
    }

    @Test
    public void cutsLongLines() {
        assertEquals("Revise Juz 1", TodayWidgetData.clip("Revise Juz 1", 40));
        assertEquals("abc…", TodayWidgetData.clip("abcdefgh", 4));
        assertEquals("", TodayWidgetData.clip(null, 4));
    }

    @Test
    public void neverCutsAnEmojiInHalf() {
        // Four characters: a, b, then one emoji made of two chars. At 4 it fits; below that the emoji goes whole.
        assertEquals("ab😀", TodayWidgetData.clip("ab😀", 4));
        assertEquals("ab…", TodayWidgetData.clip("ab😀c", 4));
        assertEquals("ab…", TodayWidgetData.clip("ab😀", 3));
    }
}
