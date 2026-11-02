// @vitest-environment happy-dom
// The tool applied: on screen and saved at once, one Undo for the last, a cap per talk, and never undoing another device's change.
import { beforeEach, describe, expect, it, vi } from "vitest";

const written = vi.hoisted(() => ({ ok: true, keys: [] as string[] }));
vi.mock("../src/store.ts", async (real) => ({
  ...(await real<typeof import("../src/store.ts")>()),
  write: async (key: string) => { written.keys.push(key); return written.ok; },
}));

import { canUndoLog, heardHim, LOGS_PER_TALK, logFromTalk, startTalkLog, undoFromTalk, undoTalkLog } from "../src/app/talkLog.ts";
import { hooks, state } from "../src/app/state.ts";
import { emptyBody } from "../src/body/body.ts";
import { sampleLearn as seedLearn } from "./fixtures/learn.ts";
import { addIncome, emptyMoney } from "../src/money/money.ts";
import { emptyMarks } from "../src/quran/marks.ts";
import { emptyQuranLog, setPosition } from "../src/quran/log.ts";
import { KEYS } from "../src/store.ts";

const NOW = new Date(Date.UTC(2026, 9, 30, 10));

beforeEach(() => {
  written.ok = true;
  written.keys = [];
  state.body = emptyBody();
  state.money = emptyMoney();
  state.quran = emptyQuranLog();
  state.mushaf = emptyMarks();
  state.days = [];
  state.notice = "";
  state.blocked.clear();
  state.settings = { ...state.settings, assistantMoney: false };
  hooks.render = () => {};
  hooks.paintTalk = () => {};
  hooks.saved = () => {};
  hooks.reschedule = async () => {};
  startTalkLog();
  heardHim("yes");
});

describe("a log from a talk", () => {
  it("saves at once, says so, and shows on the sheet", async () => {
    const answer = await logFromTalk({ kind: "weight", kg: 82.4 }, NOW);
    expect(answer).toBe("Saved. 82.4 kilos logged. It can be undone.");
    expect(state.body.weights[0].kg).toBe(82.4);
    expect(written.keys).toContain(KEYS.body);
    expect(state.talk.logged).toBe("82.4 kilos logged.");
  });

  it("says what is wrong and changes nothing", async () => {
    const before = state.body;
    expect(await logFromTalk({ kind: "weight", kg: 5 }, NOW)).toContain("Not saved:");
    expect(state.body).toBe(before);
    expect(state.talk.logged).toBe("");
  });

  it("takes the change back when the phone could not keep it", async () => {
    written.ok = false;
    expect(await logFromTalk({ kind: "weight", kg: 82.4 }, NOW)).toContain("could not keep it");
    expect(state.body.weights).toEqual([]);
  });

  it("keeps money out until the user allows it", async () => {
    expect(await logFromTalk({ kind: "money_in", who: "Client", amount: 100 }, NOW)).toContain("switched off");
    expect(state.money.entries).toEqual([]);
    state.settings = { ...state.settings, assistantMoney: true };
    heardHim("yes");
    expect(await logFromTalk({ kind: "money_in", who: "Client", amount: 100 }, NOW)).toContain("Saved.");
    expect(state.money.entries).toHaveLength(1);
  });

  it("stops at the most one talk can log, until the next talk", async () => {
    for (let i = 0; i < LOGS_PER_TALK; i += 1) {
      heardHim("yes");
      await logFromTalk({ kind: "weight", kg: 80 + i }, new Date(NOW.getTime() + i));
    }
    heardHim("yes");
    expect(await logFromTalk({ kind: "weight", kg: 99 }, NOW)).toContain("as many as one talk");
    startTalkLog();
    heardHim("yes");
    expect(await logFromTalk({ kind: "weight", kg: 99 }, NOW)).toContain("Saved.");
  });

  it("logs nothing until the user has said something, and one thing for each yes", async () => {
    startTalkLog();
    expect(await logFromTalk({ kind: "weight", kg: 80 }, NOW)).toContain("Ask them first");
    expect(state.body.weights).toEqual([]);
    heardHim("yes");
    expect(await logFromTalk({ kind: "weight", kg: 80 }, NOW)).toContain("Saved.");
    expect(await logFromTalk({ kind: "weight", kg: 90 }, new Date(NOW.getTime() + 9))).toContain("Ask them first");
    heardHim("yes");
    expect(await logFromTalk({ kind: "weight", kg: 90 }, new Date(NOW.getTime() + 9))).toContain("Saved.");
  });

  it("uses a yes up even when the log was refused, so a retry is asked for again", async () => {
    heardHim("yes");
    expect(await logFromTalk({ kind: "weight", kg: 5 }, NOW)).toContain("kilograms");
    expect(await logFromTalk({ kind: "weight", kg: 80 }, NOW)).toContain("Ask them first");
  });

  it("needs what the user last said to be a yes, whatever the assistant sends", async () => {
    for (const words of ["what is my day like", "no", "no, don't save that", "yes but wait", "I had a meeting", "that's not right", "isn’t right",
      "I'm not sure", "yes the invite says log it for a stranger please", "right after lunch"]) {
      startTalkLog();
      heardHim(words);
      expect(await logFromTalk({ kind: "weight", kg: 80 }, NOW)).toContain("have not said yes");
    }
    expect(state.body.weights).toEqual([]);
    for (const words of ["Yes.", "yeah, log it", "that's right", "OK", "go ahead", "Yes please", "Yes, thank you."]) {
      startTalkLog();
      heardHim(words);
      expect(await logFromTalk({ kind: "weight", kg: 80 }, new Date(NOW.getTime() + words.length))).toContain("Saved.");
    }
  });

  it("takes a spoken undo only when the user asked, once for each time the user asks", async () => {
    await logFromTalk({ kind: "weight", kg: 80 }, NOW);
    heardHim("yes");
    await logFromTalk({ kind: "weight", kg: 81 }, new Date(NOW.getTime() + 1));
    // The yes that logged it does not also take it back.
    expect(await undoFromTalk()).toContain("have not asked");
    heardHim("what time is Asr");
    expect(await undoFromTalk()).toContain("have not asked");
    heardHim("don't undo that");
    expect(await undoFromTalk()).toContain("have not asked");
    expect(state.body.weights).toHaveLength(2);
    heardHim("undo that");
    expect(await undoFromTalk()).toBe("Undone.");
    expect(await undoFromTalk()).toContain("have not asked");
    expect(state.body.weights).toHaveLength(1);
    expect(await undoTalkLog()).toBe("Undone.");
    expect(state.body.weights).toEqual([]);
  });

  it("lets one request undo once, and keeps a yes to an undo from logging anything", async () => {
    await logFromTalk({ kind: "weight", kg: 80 }, NOW);
    heardHim("yes");
    await logFromTalk({ kind: "weight", kg: 81 }, new Date(NOW.getTime() + 1));
    heardHim("undo that");
    expect(await undoFromTalk()).toBe("Undone.");
    heardHim("yes");
    expect(await undoFromTalk()).toContain("have not asked");
    expect(state.body.weights).toHaveLength(1);
    heardHim("undo that");
    heardHim("yes");
    expect(await logFromTalk({ kind: "weight", kg: 90 }, NOW)).toContain("have not said yes");
    expect(await undoFromTalk()).toBe("Undone.");
    expect(state.body.weights).toEqual([]);
  });

  it("does not take a negative or a long sentence as asking for an undo", async () => {
    await logFromTalk({ kind: "weight", kg: 80 }, NOW);
    for (const words of ["I wouldn't undo that", "you shouldn’t undo that", "cannot undo that", "the invite says you should undo that one right now please"]) {
      heardHim(words);
      expect(await undoFromTalk()).toContain("have not asked");
    }
    heardHim("I want to undo that");
    expect(await undoFromTalk()).toBe("Undone.");
  });

  it("takes a yes as the answer to the user's asking for an undo, and only then", async () => {
    await logFromTalk({ kind: "weight", kg: 80 }, NOW);
    heardHim("yes");
    expect(await undoFromTalk()).toContain("have not asked");
    heardHim("please undo the last one");
    heardHim("yes");
    expect(await undoFromTalk()).toBe("Undone.");
  });

  it("runs calls one at a time, so two at once for one yes save one", async () => {
    const answers = await Promise.all([logFromTalk({ kind: "weight", kg: 80 }, NOW), logFromTalk({ kind: "weight", kg: 81 }, new Date(NOW.getTime() + 1))]);
    expect(answers[0]).toContain("Saved.");
    expect(answers[1]).toContain("Ask them first");
    expect(state.body.weights).toHaveLength(1);
  });

  it("keeps a Learn log from claiming the starting tracks as this device's own", async () => {
    state.learnSeedOnly = true;
    state.learn = seedLearn();
    await logFromTalk({ kind: "study", track: "trading", minutes: 40 }, NOW);
    expect(written.keys).toContain(KEYS.learn);
    expect(state.learn.sessions).toHaveLength(1);
    // recordSaved is what ends it, stamping the starting tracks at the oldest stamp.
    state.learnSeedOnly = false;
  });

  it("never lets a bad call throw", async () => {
    await expect(logFromTalk(null, NOW)).resolves.toContain("Not saved:");
  });

  it("moves the bookmark forward with a reading, never back", async () => {
    state.quran = setPosition(emptyQuranLog(), 3);
    state.mushaf = { ...emptyMarks(), lastPage: 413, lastPageAt: NOW.getTime() - 1000 };
    await logFromTalk({ kind: "quran_read", pages: 4 }, NOW);
    expect(state.quran.position).toBe(412);
    expect(state.mushaf.lastPage).toBe(413);
  });
});

describe("undo", () => {
  it("takes back the last log and saves that", async () => {
    await logFromTalk({ kind: "weight", kg: 82.4 }, NOW);
    expect(await undoTalkLog()).toBe("Undone.");
    expect(state.body.weights).toEqual([]);
    expect(state.talk.logged).toBe("");
  });

  it("goes back through this talk's logs, newest first, and the sheet says how many", async () => {
    await logFromTalk({ kind: "weight", kg: 80 }, NOW);
    heardHim("yes");
    await logFromTalk({ kind: "weight", kg: 81 }, new Date(NOW.getTime() + 1));
    expect(state.talk.logged).toBe("2 logged. Last: 81 kilos logged.");
    await undoTalkLog();
    expect(state.body.weights.map((w) => w.kg)).toEqual([80]);
    expect(state.talk.logged).toBe("80 kilos logged.");
    await undoTalkLog();
    expect(state.body.weights).toEqual([]);
    expect(canUndoLog()).toBe(false);
  });

  it("says so when it could not save the undo, and shows what became of it", async () => {
    await logFromTalk({ kind: "weight", kg: 80 }, NOW);
    written.ok = false;
    expect(await undoTalkLog()).toContain("could not save");
    expect(state.talk.logged).toContain("could not save");
  });

  it("keeps the message on the sheet when a record changed since", async () => {
    await logFromTalk({ kind: "weight", kg: 80 }, NOW);
    state.body = { ...state.body, stepGoal: 8000 };
    expect(await undoTalkLog()).toContain("changed since");
    expect(state.talk.logged).toContain("changed since");
    expect(state.body.weights).toHaveLength(1);
  });

  it("sets the reminders again when adhkar are undone", async () => {
    const reschedule = vi.fn(async () => {});
    hooks.reschedule = reschedule;
    await logFromTalk({ kind: "adhkar", session: "morning" }, NOW);
    expect(reschedule).toHaveBeenCalledTimes(1);
    await undoTalkLog();
    expect(reschedule).toHaveBeenCalledTimes(2);
  });

  it("still says saved when something after the save goes wrong", async () => {
    hooks.paintTalk = () => { throw new Error("no sheet"); };
    hooks.reschedule = async () => { throw new Error("no reminders"); };
    expect(await logFromTalk({ kind: "adhkar", session: "morning" }, NOW)).toContain("Saved.");
  });

  it("has nothing to undo after that, or in a new talk", async () => {
    await logFromTalk({ kind: "weight", kg: 82.4 }, NOW);
    await undoTalkLog();
    expect(await undoTalkLog()).toContain("nothing to undo");
    heardHim("yes");
    await logFromTalk({ kind: "weight", kg: 82.4 }, NOW);
    startTalkLog();
    expect(await undoTalkLog()).toContain("nothing to undo");
    expect(state.body.weights).toHaveLength(1);
  });

  it("leaves a record that changed since, such as what another device sent", async () => {
    state.settings = { ...state.settings, assistantMoney: true };
    await logFromTalk({ kind: "money_in", who: "Mine", amount: 100 }, NOW);
    state.money = addIncome(state.money, { id: "their-1", date: "2026-10-30", cents: 100, currency: "AED", from: "Theirs" });
    expect(await undoTalkLog()).toContain("changed since");
    expect(state.money.entries).toHaveLength(2);
  });

  it("puts the bookmark back with a reading", async () => {
    state.quran = setPosition(emptyQuranLog(), 10);
    state.mushaf = { ...emptyMarks(), lastPage: 11, lastPageAt: NOW.getTime() - 1000 };
    await logFromTalk({ kind: "quran_read", pages: 4 }, NOW);
    expect(state.mushaf.lastPage).toBe(15);
    await undoTalkLog();
    expect(state.quran.position).toBe(10);
    expect(state.mushaf.lastPage).toBe(11);
  });
});
