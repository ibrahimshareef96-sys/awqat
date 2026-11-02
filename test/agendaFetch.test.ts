// A calendar file fetched: only https, the answer read as text, and every failure named without the address.
import { describe, expect, it } from "vitest";
import type { HttpOptions, HttpResponse } from "@capacitor/core";
import { CALENDAR_FILE_MAX, fetchCalendar } from "../src/agenda/fetch.ts";

const URL = "https://example.com/calendar/ical/x/private-abc/basic.ics";
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";

const answer = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  async (): Promise<HttpResponse> => ({ status, data, headers, url: URL });

describe("fetching a calendar", () => {
  it("asks for text from the address, with time limits", async () => {
    let asked: HttpOptions | null = null;
    const result = await fetchCalendar(URL, async (o) => { asked = o; return { status: 200, data: ICS, headers: {}, url: URL }; });
    expect(result).toEqual({ text: ICS });
    expect(asked).toMatchObject({ url: URL, responseType: "text", connectTimeout: 10000, readTimeout: 30000 });
  });

  it("never asks for anything but https", async () => {
    let called = false;
    const result = await fetchCalendar("http://example.com/a.ics", async () => { called = true; return answer(200, ICS)(); });
    expect(result).toEqual({ problem: "failed" });
    expect(called).toBe(false);
  });

  it("names what went wrong", async () => {
    expect(await fetchCalendar(URL, answer(401, ""))).toEqual({ problem: "refused" });
    expect(await fetchCalendar(URL, answer(403, ""))).toEqual({ problem: "refused" });
    expect(await fetchCalendar(URL, answer(404, ""))).toEqual({ problem: "notFound" });
    expect(await fetchCalendar(URL, answer(500, ""))).toEqual({ problem: "failed" });
    expect(await fetchCalendar(URL, answer(200, "<html>Sign in</html>"))).toEqual({ problem: "notCalendar" });
    expect(await fetchCalendar(URL, answer(200, { json: true }))).toEqual({ problem: "notCalendar" });
    expect(await fetchCalendar(URL, async () => { throw new Error(`no network for ${URL}`); })).toEqual({ problem: "offline" });
  });

  it("refuses a file too big to read, by its header or its length", async () => {
    expect(await fetchCalendar(URL, answer(200, ICS, { "Content-Length": String(CALENDAR_FILE_MAX + 1) })))
      .toEqual({ problem: "tooBig" });
    expect(await fetchCalendar(URL, answer(200, `${ICS}${"x".repeat(CALENDAR_FILE_MAX)}`))).toEqual({ problem: "tooBig" });
  });

  it("follows a redirect to another https address on the internet, and asks with redirects off", async () => {
    const asked: HttpOptions[] = [];
    const result = await fetchCalendar(URL, async (o): Promise<HttpResponse> => {
      asked.push(o);
      return asked.length === 1
        ? { status: 301, data: "", headers: { Location: "https://calendar.example.com/published/2/abc" }, url: URL }
        : { status: 200, data: ICS, headers: {}, url: o.url };
    });
    expect(result).toEqual({ text: ICS });
    expect(asked.map((o) => [o.url, o.disableRedirects])).toEqual([[URL, true],
      ["https://calendar.example.com/published/2/abc", true]]);
  });

  it("refuses a redirect into a home network, to plain http, or round and round", async () => {
    for (const location of ["https://192.168.1.1/x", "http://example.com/x.ics", "https://nas.local/cal"]) {
      let calls = 0;
      const result = await fetchCalendar(URL, async () => {
        calls++;
        return { status: 302, data: "", headers: { location }, url: URL };
      });
      expect(result).toEqual({ problem: "failed" });
      expect(calls).toBe(1);
    }
    let loops = 0;
    const loop = await fetchCalendar(URL, async () => {
      loops++;
      return { status: 302, data: "", headers: { location: URL }, url: URL };
    });
    expect(loop).toEqual({ problem: "failed" });
    expect(loops).toBe(4);
    expect(await fetchCalendar(URL, answer(302, ""))).toEqual({ problem: "failed" });
  });

  it("gives up on a server that never finishes sending", async () => {
    const never = () => new Promise<HttpResponse>(() => undefined);
    expect(await fetchCalendar(URL, never, 20)).toEqual({ problem: "offline" });
  });

  it("allows a little space before the calendar begins", async () => {
    expect(await fetchCalendar(URL, answer(200, `\r\n${ICS}`))).toEqual({ text: `\r\n${ICS}` });
  });
});
