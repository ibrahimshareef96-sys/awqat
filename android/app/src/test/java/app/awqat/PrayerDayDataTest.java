package app.awqat;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** The prayer day widget picks the day under way, its current prayer, the next one and the iqama from the snapshot. */
public class PrayerDayDataTest {
    private static final String[] NAMES = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
    private static final String[] TIMES = {"05:00", "12:00", "15:00", "18:00", "19:30"};

    /** A day whose prayers come at these times, each over at `until` (0 for none), with an iqama 10 after each. */
    private static PrayerDayData.Day day(long[] at, long[] until, long[] iqama) {
        String[] iqamaTimes = new String[at.length];
        for (int i = 0; i < at.length; i++) iqamaTimes[i] = iqama[i] > 0 ? "t" + i : "";
        return new PrayerDayData.Day("12 Jumada al-Ula 1448", NAMES, TIMES, at, until, iqama, iqamaTimes);
    }

    // Two days, 1,000 apart: prayers at 100, 200, 300, 400, 500, Fajr over at 150 (sunrise), Isha at the next Fajr.
    private static final PrayerDayData.Day ONE = day(new long[] {100, 200, 300, 400, 500},
            new long[] {150, 300, 400, 500, 1100}, new long[] {110, 0, 310, 405, 510});
    private static final PrayerDayData.Day TWO = day(new long[] {1100, 1200, 1300, 1400, 1500},
            new long[] {1150, 1300, 1400, 1500, 0}, new long[] {1110, 1210, 1310, 1405, 1510});
    private static final PrayerDayData.Day[] DAYS = {ONE, TWO};

    @Test
    public void picksTheDayUnderWayFromFajrToFajr() {
        assertEquals(0, PrayerDayData.dayIndex(DAYS, 50));
        assertEquals(0, PrayerDayData.dayIndex(DAYS, 900));
        assertEquals(1, PrayerDayData.dayIndex(DAYS, 1100));
        assertEquals(-1, PrayerDayData.dayIndex(new PrayerDayData.Day[0], 1100));
    }

    @Test
    public void marksThePrayerUnderWayAndNoneBetweenSunriseAndDhuhr() {
        assertEquals(-1, PrayerDayData.current(ONE, 50));
        assertEquals(0, PrayerDayData.current(ONE, 120));
        assertEquals(-1, PrayerDayData.current(ONE, 160));
        assertEquals(2, PrayerDayData.current(ONE, 300));
        // Isha runs on past midnight, until the next Fajr.
        assertEquals(4, PrayerDayData.current(ONE, 1050));
        // With no end given, it stays under way.
        assertEquals(4, PrayerDayData.current(TWO, 9_999));
    }

    @Test
    public void findsTheNextPrayerAcrossDaysAndSaysWhenItRunsOut() {
        PrayerDayData.Pick next = PrayerDayData.next(DAYS, 550);
        assertEquals(1, next.day);
        assertEquals(0, next.prayer);
        assertEquals(2, PrayerDayData.next(DAYS, 200).prayer);
        assertNull(PrayerDayData.next(DAYS, 1500));
    }

    @Test
    public void showsTheIqamaUnderWayElseTheNextOnesAndNoneForJumuah() {
        // Asr has come, its iqama at 310 is still ahead.
        PrayerDayData.Pick asr = PrayerDayData.iqama(DAYS, 0, 2, PrayerDayData.next(DAYS, 305), 305);
        assertEquals(2, asr.prayer);
        // Its iqama has passed: Maghrib's comes next.
        assertEquals(3, PrayerDayData.iqama(DAYS, 0, 2, PrayerDayData.next(DAYS, 350), 350).prayer);
        // Dhuhr is next and has no iqama (Jumu'ah).
        assertNull(PrayerDayData.iqama(DAYS, 0, -1, PrayerDayData.next(DAYS, 160), 160));
        assertNull(PrayerDayData.iqama(DAYS, 1, 4, null, 2_000));
    }

    @Test
    public void wakesAtTheNextPrayerItsEndOrAnIqama() {
        assertEquals(110, PrayerDayData.nextChange(DAYS, 100));
        assertEquals(150, PrayerDayData.nextChange(DAYS, 110));
        assertEquals(1100, PrayerDayData.nextChange(DAYS, 510));
        assertEquals(-1, PrayerDayData.nextChange(DAYS, 2_000));
    }

    @Test
    public void keepsAPercentInANameAsText() {
        assertEquals("Asr in %s", PrayerDayData.countdownFormat("Asr", "in"));
        assertEquals("100%% in %s", PrayerDayData.countdownFormat("100%", "in"));
    }
}
