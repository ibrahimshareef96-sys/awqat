// The Learn screens: Home's card, every track this week, one track, the review one lesson at a time, and the sheets;
// everything the user typed is escaped, every field has a label and a length limit, and only what the user wrote is shown.
import { describe, expect, it } from "vitest";
import {
  addItem, addLesson, addTrack, cycleItem, emptyLearn, logSession, setArchived, type Learn,
} from "../src/learn/learn.ts";
import { TRADING_ID, sampleLearn as seedLearn } from "./fixtures/learn.ts";
import {
  homeLearnCard, isLearnSheet, learnSheet, learnView, reviewView, trackSubtitle, trackView, type LearnModel,
} from "../src/ui/learnView.ts";

const TODAY = "2026-10-28";
const EVIL = `<img src=x onerror="alert(1)">`;

const model = (learn: Learn, extra: Partial<LearnModel> = {}): LearnModel => ({ learn, today: TODAY, removeArmed: null, ...extra });
const study = (learn: Learn, trackId: string, minutes: number, day = TODAY): Learn =>
  logSession(learn, { trackId, itemId: null, minutes, note: "" }, day).learn;
const note = (learn: Learn, trackId: string, text: string, source = "", day = "2026-10-20"): Learn =>
  addLesson(learn, { trackId, itemId: null, text, source }, day).learn;
const track = (learn: Learn, id: string) => learn.tracks.find((t) => t.id === id)!;

describe("Home's Learn card", () => {
  it("asks for a first track when there is none", () => {
    expect(homeLearnCard(emptyLearn(), TODAY)).toContain("Add what you are learning");
    expect(homeLearnCard(emptyLearn(), TODAY)).toContain('data-go="learn"');
  });

  it("shows this week's study against the targets, and the notes waiting", () => {
    let learn = study(seedLearn(), TRADING_ID, 90);
    learn = study(learn, TRADING_ID, 600, "2026-10-19");
    const html = homeLearnCard(learn, TODAY);
    expect(html).toContain("1 h 30 min <span class=\"soft\">of 4 h</span>");
    expect(html).toContain('data-w="38"');
    expect(html).not.toContain("to review");
    expect(homeLearnCard(note(learn, TRADING_ID, "A"), TODAY)).toContain("1 note to review");
    expect(homeLearnCard(note(note(learn, TRADING_ID, "A"), TRADING_ID, "B"), TODAY)).toContain("2 notes to review");
  });

  it("says the minutes alone when no track has a target", () => {
    const r = addTrack(emptyLearn(), { name: "Fiqh", kind: "islamic", weeklyMinutes: 0 }, TODAY);
    const html = homeLearnCard(study(r.learn, r.id!, 20), TODAY);
    expect(html).toContain("20 min <span class=\"soft\">this week</span>");
    expect(html).not.toContain("data-w");
  });
});

describe("the Learn screen", () => {
  it("shows each track still studied with its week, its next item and its three buttons", () => {
    const html = learnView(model(study(seedLearn(), TRADING_ID, 30)), "", "", "");
    expect(html).toContain("Next: Sara Example, Sample Markets: lecture 2");
    expect(html).toContain('data-go="learn:track-trading"');
    for (const action of ["learn-log", "learn-add-item", "learn-add-lesson", "learn-archive"]) {
      expect(html).toContain(`data-action="${action}" data-value="track-tafsir"`);
    }
    expect(html).toContain('aria-label="Log study time for Hadith"');
    expect(html).toContain("No items yet");
    expect(html).toContain('data-action="learn-add-track"');
    expect(html).not.toContain("learn-review");
  });

  it("offers the review only when lessons are due, and lists archived tracks to bring back", () => {
    const learn = setArchived(note(seedLearn(), TRADING_ID, "A"), "track-fiqh", true);
    const html = learnView(model(learn), "", "", "");
    expect(html).toContain('data-go="learn-review"');
    expect(html).toContain("Review 1 note");
    expect(html).toContain("ARCHIVED");
    expect(html).toContain('aria-label="Bring back Fiqh"');
    expect(html).not.toContain('data-action="learn-log" data-value="track-fiqh"');
  });

  it("escapes a track's name and its next item's title", () => {
    const r = addTrack(emptyLearn(), { name: EVIL, kind: "worldly", weeklyMinutes: 60 }, TODAY);
    const learn = addItem(r.learn, r.id!, { title: EVIL, kind: "book", url: null }, TODAY).learn;
    const html = learnView(model(learn), "", "", "") + homeLearnCard(learn, TODAY) +
      trackView(track(learn, r.id!), model(learn), "", "", "");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("a track's screen", () => {
  it("lists items in order with status chips, Open only for a link, and a Remove that asks twice", () => {
    const learn = cycleItem(seedLearn(), "trading-shiller-02", TODAY);
    const html = trackView(track(learn, TRADING_ID), model(learn, { removeArmed: "trading-housel" }), "", "", "");
    expect(html.indexOf("lecture 2")).toBeLessThan(html.indexOf("lecture 15"));
    expect(html).toContain('class="chip status-chip doing" data-action="learn-item" data-value="trading-shiller-02"');
    expect(html).toContain("Sara Example, Sample Markets: lecture 2: doing. Tap to change.");
    expect(html).toContain("0 of 17 done");
    expect(html).toContain('data-action="learn-open" data-value="trading-carver"');
    expect(html).not.toContain('data-action="learn-open" data-value="trading-housel"');
    expect(html).toContain("example.com");
    expect(html).toContain("Tap again to remove</button>");
    expect(html).toContain('data-form="learn-target"');
    expect(html).toContain('value="240"');
  });

  it("shows this week's study and the lessons, newest first, the user's words and source escaped", () => {
    let learn = logSession(seedLearn(), { trackId: TRADING_ID, itemId: "trading-carver", minutes: 50, note: EVIL }, TODAY).learn;
    learn = study(learn, TRADING_ID, 999 % 600, "2026-10-19");
    learn = note(learn, TRADING_ID, `Older ${EVIL}`, "p. 12", "2026-10-01");
    learn = note(learn, TRADING_ID, "Newer\nsecond line", EVIL, "2026-10-27");
    const html = trackView(track(learn, TRADING_ID), model(learn), "", "", "");
    expect(html).toContain("Wednesday · 50 min");
    expect(html).toContain("Yusuf Example, Sample Trading");
    expect(html).not.toContain("Monday · 399 min");
    expect(html.indexOf("Newer")).toBeLessThan(html.indexOf("Older"));
    expect(html).toContain("Newer\nsecond line");
    expect(html).not.toContain("<img");
    expect(html).toContain("p. 12 · noted 1 Oct · review 2 Oct");
  });

  it("deletes a lesson or study time only on a second tap, each button naming what it deletes", () => {
    let learn = study(seedLearn(), TRADING_ID, 35);
    learn = note(learn, TRADING_ID, "Position size follows the stop, not the conviction of the moment");
    const [session, lesson] = [learn.sessions[0].id, learn.lessons[0].id];
    const html = trackView(track(learn, TRADING_ID), model(learn, { removeArmed: lesson }), "", "", "");
    expect(html).toContain(`data-action="learn-session-remove" data-value="${session}" ` +
      `aria-label="Delete the study time Wednesday · 35 min">Delete</button>`);
    expect(html).toContain(`data-action="learn-lesson-remove" data-value="${lesson}" ` +
      `aria-label="Tap again to delete the lesson Position size follows the stop, not the…">Tap again to delete</button>`);
  });

  it("does not promise a review on an archived track's screen", () => {
    const learn = setArchived(note(seedLearn(), "track-fiqh", "A ruling"), "track-fiqh", true);
    const html = trackView(track(learn, "track-fiqh"), model(learn), "", "", "");
    expect(html).toContain("They rest while this track is archived.");
    expect(html).not.toContain("Each comes back for review.");
  });

  it("shows the newest 50 lessons and says how many more there are", () => {
    let learn = seedLearn();
    for (let i = 0; i < 53; i += 1) learn = note(learn, TRADING_ID, `Lesson ${i}`);
    const html = trackView(track(learn, TRADING_ID), model(learn), "", "", "");
    expect(html.match(/data-action="learn-lesson-remove"/g)).toHaveLength(50);
    expect(html).toContain("And 3 older.");
  });

  it("says under its name whether it is Islamic or worldly, and archived", () => {
    const learn = setArchived(seedLearn(), "track-tafsir", true);
    expect(trackSubtitle(track(learn, "track-tafsir"))).toBe("Islamic · archived");
    expect(trackSubtitle(track(learn, TRADING_ID))).toBe("Worldly");
  });
});

describe("the review", () => {
  it("shows one due lesson: its source as the user typed it, the lesson folded until asked for", () => {
    let learn = note(seedLearn(), "track-hadith", "My own words", "Sahih Muslim 2699", "2026-10-20");
    learn = note(learn, TRADING_ID, "Second", "", "2026-10-25");
    const html = reviewView(model(learn), "", "", "");
    const id = learn.lessons[0].id;
    expect(html).toContain('<p class="review-prompt">Sahih Muslim 2699</p>');
    expect(html).toContain(`<details class="more" id="reveal-${id}">`);
    expect(html).toContain("My own words");
    expect(html).not.toContain("Second");
    expect(html).toContain("2 left today");
    expect(html).toContain(`data-action="learn-remembered" data-value="${id}"`);
    expect(html).toContain(`data-action="learn-again" data-value="${id}"`);
  });

  it("uses the item's title when there is no source, and escapes both", () => {
    const withItem = addItem(seedLearn(), "track-fiqh", { title: EVIL, kind: "lecture", url: null }, TODAY);
    const learn = addLesson(withItem.learn, { trackId: "track-fiqh", itemId: withItem.id, text: EVIL, source: "" },
      "2026-10-20").learn;
    const html = reviewView(model(learn), "", "", "");
    expect(html).not.toContain("<img");
    expect(html).toContain('<p class="review-prompt">&lt;img');
  });

  it("says when nothing is due", () => {
    expect(reviewView(model(seedLearn()), "", "", "")).toContain("Nothing to review today.");
  });
});

describe("the sheets", () => {
  const sheets = ["learn-session", "learn-item", "learn-lesson", "learn-track"] as const;
  const sheetModel = { learn: note(seedLearn(), TRADING_ID, "x"), track: track(seedLearn(), TRADING_ID), minutes: null };

  it("knows its own sheets and no others", () => {
    for (const s of sheets) expect(isLearnSheet(s)).toBe(true);
    for (const s of [null, "talk", "learn", "learn-"]) expect(isLearnSheet(s)).toBe(false);
  });

  it("gives every field a label and every text field a length limit", () => {
    for (const kind of sheets) {
      const html = learnSheet(kind, sheetModel);
      const fields = html.match(/<(input|textarea|select)\b[^>]*>/g) ?? [];
      expect(fields.length).toBeGreaterThan(1);
      for (const field of fields) {
        const id = /\bid="([^"]+)"/.exec(field)?.[1];
        expect(id && html.includes(`for="${id}"`)).toBe(true);
        if (!/type="number"/.test(field) && !field.startsWith("<select")) expect(field).toMatch(/maxlength="\d+"/);
      }
      expect(html).toContain("data-sheet-error");
      expect(html).toContain('role="dialog"');
    }
  });

  it("lets every Learn form reach the app's own checks, which say in the sheet what is wrong", () => {
    const forms = [...sheets.map((kind) => learnSheet(kind, sheetModel)),
      trackView(track(seedLearn(), TRADING_ID), model(seedLearn()), "", "", "")].join("");
    const tags = forms.match(/<form\b[^>]*>/g) ?? [];
    expect(tags).toHaveLength(5);
    for (const tag of tags) expect(tag).toContain(" novalidate");
  });

  it("picks the item the user is on, leaves done items out of study time, and keeps them for a lesson", () => {
    const learn = cycleItem(cycleItem(seedLearn(), "trading-shiller-02", TODAY), "trading-shiller-02", TODAY);
    const m = { learn, track: track(learn, TRADING_ID), minutes: null };
    const session = learnSheet("learn-session", m);
    expect(session).not.toContain('value="trading-shiller-02"');
    expect(session).toContain('<option value="trading-shiller-15" selected>');
    expect(learnSheet("learn-lesson", m)).toContain('value="trading-shiller-02"');
  });

  it("names the track, escaped, and says so when the track has gone", () => {
    const r = addTrack(emptyLearn(), { name: EVIL, kind: "islamic", weeklyMinutes: 0 }, TODAY);
    const html = learnSheet("learn-lesson", { learn: r.learn, track: track(r.learn, r.id!), minutes: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("For example Al-Baqarah 255");
    expect(learnSheet("learn-item", { learn: r.learn, track: null, minutes: null })).toContain("That track is no longer here.");
  });
});
