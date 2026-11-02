/**
 * One meeting or all-day event on a day of the agenda, and the limits on what is kept of it. Apart from the calendar
 * reader, so the app can show its kept agenda without loading the reader (and ical.js with it).
 */
export interface Occurrence {
  /** Instants in milliseconds; for an all-day event, where its days begin and end in the window's time zone. */
  start: number;
  end: number;
  allDay: boolean;
  title: string;
  location: string;
}

export const OCCURRENCES_MAX = 300;
export const TITLE_MAX = 200;
export const LOCATION_MAX = 200;
