// Reading a calendar in a worker: what comes back, a read that runs out of time, and a worker that fails. A worker
// that could not start hands the file to the screen's thread; one that failed while reading never does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Window } from "../src/agenda/ical.ts";
import { parseCalendar } from "../src/agenda/parse.ts";
import { WORKER_READY } from "../src/agenda/workerMessages.ts";

const WEEK: Window = { firstDay: "2026-10-26", endDay: "2026-11-03", timeZone: "Asia/Dubai" };
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Team\r\nEND:VCALENDAR";

/** A worker the test drives by hand: it records what it was sent and whether it was ended. */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  ended = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(data: unknown): void {
    this.sent.push(data);
  }
  terminate(): void {
    this.ended = true;
  }
}

const worker = (): FakeWorker => {
  if (!FakeWorker.last) throw new Error("no worker was started");
  return FakeWorker.last;
};

beforeEach(() => {
  FakeWorker.last = null;
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reading a calendar in a worker", () => {
  it("sends the file to the worker and gives back what it read", async () => {
    const reading = parseCalendar(ICS, WEEK);
    expect(worker().sent).toEqual([{ text: ICS, window: WEEK }]);
    worker().onmessage?.({ data: WORKER_READY });
    worker().onmessage?.({ data: { name: "Team", events: [], truncated: false } });
    expect(await reading).toEqual({ name: "Team", events: [], truncated: false });
    expect(worker().ended).toBe(true);
  });

  it("is not finished by the worker saying it is running", async () => {
    vi.useFakeTimers();
    const reading = parseCalendar(ICS, WEEK, 50);
    worker().onmessage?.({ data: WORKER_READY });
    expect(worker().ended).toBe(false);
    vi.advanceTimersByTime(50);
    expect(await reading).toBe("slow");
    expect(worker().ended).toBe(true);
  });

  it("reads the file here when the worker could not start", async () => {
    const reading = parseCalendar(ICS, WEEK);
    worker().onerror?.();
    expect(await reading).toMatchObject({ name: "Team", truncated: false });
    expect(worker().ended).toBe(true);
  });

  it("never reads the file here when the worker failed while reading it", async () => {
    const reading = parseCalendar(ICS, WEEK);
    worker().onmessage?.({ data: WORKER_READY });
    worker().onerror?.();
    expect(await reading).toBe("slow");
    expect(worker().ended).toBe(true);
  });

  it("calls a worker that never answers too slow", async () => {
    vi.useFakeTimers();
    const reading = parseCalendar(ICS, WEEK, 50);
    vi.advanceTimersByTime(50);
    expect(await reading).toBe("slow");
    expect(worker().ended).toBe(true);
  });
});
