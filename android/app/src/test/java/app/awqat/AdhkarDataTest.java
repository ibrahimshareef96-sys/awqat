package app.awqat;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The adhkar widget says, for the day under way, whether each set is said, open now, or later. */
public class AdhkarDataTest {
    // Morning 100 to 200, evening 300 to 400; the next day's from 1,100.
    private static final AdhkarData.Day ONE = new AdhkarData.Day(100, 200, true, 300, 400, false);
    private static final AdhkarData.Day TWO = new AdhkarData.Day(1100, 1200, false, 1300, 1400, false);
    private static final AdhkarData.Day[] DAYS = {ONE, TWO};

    @Test
    public void picksTheDayUnderWay() {
        assertEquals(0, AdhkarData.dayIndex(DAYS, 50));
        assertEquals(0, AdhkarData.dayIndex(DAYS, 350));
        assertEquals(1, AdhkarData.dayIndex(DAYS, 1_100));
        assertEquals(-1, AdhkarData.dayIndex(new AdhkarData.Day[0], 1_100));
    }

    @Test
    public void showsTheComingDayOnceTheMiddleOfTheNightHasPassed() {
        // Day one's evening closed at 400: until the next Fajr (1,100) both sets shown are day two's, still to come.
        assertEquals(1, AdhkarData.dayIndex(DAYS, 400));
        assertEquals(1, AdhkarData.dayIndex(DAYS, 1_050));
        // With no next day, the last one stays.
        assertEquals(1, AdhkarData.dayIndex(DAYS, 1_500));
    }

    @Test
    public void saysSaidOpenNowOrLater() {
        assertEquals(AdhkarData.SAID, AdhkarData.state(ONE.morningFrom, ONE.morningTo, ONE.morningSaid, 150));
        assertEquals(AdhkarData.LATER, AdhkarData.state(ONE.eveningFrom, ONE.eveningTo, ONE.eveningSaid, 250));
        assertEquals(AdhkarData.OPEN, AdhkarData.state(ONE.eveningFrom, ONE.eveningTo, ONE.eveningSaid, 300));
        // Closed for the day and not said: it comes again later, with the next day.
        assertEquals(AdhkarData.LATER, AdhkarData.state(ONE.eveningFrom, ONE.eveningTo, ONE.eveningSaid, 400));
    }

    @Test
    public void wakesAsASetOpensOrCloses() {
        assertEquals(200, AdhkarData.nextChange(DAYS, 150));
        assertEquals(1_100, AdhkarData.nextChange(DAYS, 400));
        assertEquals(-1, AdhkarData.nextChange(DAYS, 1_400));
    }
}
