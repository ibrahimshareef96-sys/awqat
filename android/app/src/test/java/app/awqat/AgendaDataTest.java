package app.awqat;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The agenda widget picks the meeting on now or next, names its day, and wakes as meetings begin and end. */
public class AgendaDataTest {
    private static final long[] START = {100, 300, 900};
    private static final long[] END = {200, 400, 950};

    @Test
    public void picksTheMeetingUnderWayOrTheNextToBegin() {
        assertEquals(0, AgendaData.next(START, END, 50));
        assertEquals(0, AgendaData.next(START, END, 150));
        assertEquals(1, AgendaData.next(START, END, 200));
        assertEquals(-1, AgendaData.next(START, END, 950));
        // Out of order, the soonest still wins.
        assertEquals(1, AgendaData.next(new long[] {900, 300}, new long[] {950, 400}, 50));
    }

    @Test
    public void namesItsDay() {
        assertEquals(AgendaData.NOW, AgendaData.when("2026-10-23", "2026-10-23", "2026-10-24", 100, 200, 150));
        assertEquals(AgendaData.TODAY, AgendaData.when("2026-10-23", "2026-10-23", "2026-10-24", 300, 400, 150));
        assertEquals(AgendaData.TOMORROW, AgendaData.when("2026-10-24", "2026-10-23", "2026-10-24", 900, 950, 150));
        assertEquals(AgendaData.LATER, AgendaData.when("2026-10-26", "2026-10-23", "2026-10-24", 900, 950, 150));
    }

    @Test
    public void wakesAsAMeetingBeginsOrEndsOrAtMidnight() {
        assertEquals(100, AgendaData.nextChange(START, END, 50, 500));
        assertEquals(200, AgendaData.nextChange(START, END, 150, 500));
        assertEquals(500, AgendaData.nextChange(START, END, 400, 500));
        assertEquals(500, AgendaData.nextChange(new long[0], new long[0], 400, 500));
        assertEquals(-1, AgendaData.nextChange(new long[0], new long[0], 600, 500));
    }
}
