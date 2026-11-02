// What the assistant may log: each kind, checked like anything from outside, and nothing it was not told to do.
import { describe, expect, it } from "vitest";
import { emptyBody } from "../src/body/body.ts";
import { adhkarFor, emptyAdhkarLog, progress } from "../src/faith/adhkar.ts";
import { sampleLearn as seedLearn } from "./fixtures/learn.ts";
import { emptyMoney } from "../src/money/money.ts";
import { emptyLog } from "../src/prayer/log.ts";
import { emptyQuranLog, setPosition } from "../src/quran/log.ts";
import { planLog, type LogPlan, type LogWorld } from "../src/talk/logTool.ts";

const TODAY = "2026-10-30";

function world(patch: Partial<LogWorld> = {}): LogWorld {
  return { today: TODAY, prayerDay: TODAY, bookmark: 1, quran: emptyQuranLog(), prayers: emptyLog(), adhkar: emptyAdhkarLog(),
    learn: seedLearn(), body: emptyBody(), money: emptyMoney(), moneyAllowed: true, dhikrOpen: () => true, newId: () => "t-1", ...patch };
}

function planned(args: unknown, w = world()): LogPlan {
  const out = planLog(args, w, 1000);
  if (!out.ok) throw new Error(out.said);
  return out.plan;
}

const said = (args: unknown, w = world()): string => {
  const out = planLog(args, w, 1000);
  return out.ok ? "" : out.said;
};

describe("reading", () => {
  it("adds pages from the user's place", () => {
    const plan = planned({ kind: "quran_read", pages: 4 }, world({ quran: setPosition(emptyQuranLog(), 10), bookmark: 11 }));
    expect(plan.store).toBe("quran");
    expect(plan.value).toMatchObject({ position: 14 });
    expect(plan.said).toContain("up to page 14");
  });

  it("catches a log that fell behind the mushaf up to it, counting only the pages said", () => {
    const plan = planned({ kind: "quran_read", pages: 4 }, world({ quran: setPosition(emptyQuranLog(), 3), bookmark: 413 }));
    const value = plan.value as ReturnType<typeof emptyQuranLog>;
    expect(value.position).toBe(412);
    expect(value.entries.at(-1)).toMatchObject({ fromPage: 409, toPage: 412, date: TODAY });
  });

  it("takes a number sent as words of digits, and refuses anything else", () => {
    expect(planned({ kind: "quran_read", pages: "4" }).store).toBe("quran");
    for (const pages of [0, -1, 61, 2.5, "four", null, undefined]) {
      expect(said({ kind: "quran_read", pages })).toContain("how many pages");
    }
  });

  it("finishes a reading at the last page", () => {
    const plan = planned({ kind: "quran_read", pages: 4 }, world({ quran: setPosition(emptyQuranLog(), 600), bookmark: 601 }));
    expect(plan.said).toBe("A full reading complete.");
  });
});

describe("prayer and adhkar", () => {
  it("marks a prayer as the user said it, on the prayer day", () => {
    const plan = planned({ kind: "prayer", prayer: "Asr", mosque: true }, world({ prayerDay: "2026-10-29" }));
    const value = plan.value as ReturnType<typeof emptyLog>;
    expect(value.days["2026-10-29"].prayers.asr).toEqual({ status: "ontime", mosque: true });
    expect(plan.said).toBe("Asr marked on time at the mosque.");
  });

  it("never marks a late prayer at the mosque, and refuses a prayer that is not one", () => {
    const plan = planned({ kind: "prayer", prayer: "isha", status: "late", mosque: true });
    expect((plan.value as ReturnType<typeof emptyLog>).days[TODAY].prayers.isha).toEqual({ status: "late", mosque: false });
    expect(said({ kind: "prayer", prayer: "__proto__" })).toContain("which prayer");
  });

  it("reads a status however it is written, and refuses one it does not know rather than saying on time", () => {
    const plan = planned({ kind: "prayer", prayer: "fajr", status: "Late" });
    expect((plan.value as ReturnType<typeof emptyLog>).days[TODAY].prayers.fajr?.status).toBe("late");
    expect(planned({ kind: "prayer", prayer: "fajr", status: "on time" }).said).toBe("Fajr marked on time.");
    expect(said({ kind: "prayer", prayer: "fajr", status: "missed" })).toContain("on time or late");
  });

  it("marks a set of adhkar done", () => {
    const plan = planned({ kind: "adhkar", session: "morning" });
    const p = progress(plan.value as ReturnType<typeof emptyAdhkarLog>, TODAY, "morning");
    expect(p.done).toBe(p.total);
  });

  it("leaves what waits for Maghrib, and says so", () => {
    const night = adhkarFor("evening").find((d) => d.night);
    if (!night) throw new Error("the evening set has a night item");
    const plan = planned({ kind: "adhkar", session: "evening" }, world({ dhikrOpen: (_s, id) => id !== night.id }));
    expect(plan.said).toContain("waits for Maghrib");
  });

  it("refuses a set that is not one", () => {
    expect(said({ kind: "adhkar", session: "night" })).toContain("morning or evening");
  });
});

describe("study", () => {
  it("logs minutes to the subject the user named, by part of its name", () => {
    const plan = planned({ kind: "study", track: "trad", minutes: 40 });
    expect(plan.said).toBe("40 min of Trading logged.");
  });

  it("names the user's subjects when it cannot tell", () => {
    expect(said({ kind: "study", track: "cooking", minutes: 40 })).toContain("Trading");
    expect(said({ kind: "study", minutes: 40 })).toContain("Trading");
    expect(said({ kind: "study", track: "trading", minutes: 9000 })).toContain("1 to 600");
  });

  it("keeps a lesson in the user's words, cleaned", () => {
    const words = `Position size before entry${String.fromCodePoint(0x202e)}`;
    const plan = planned({ kind: "lesson", track: "trading", text: words });
    const lesson = (plan.value as ReturnType<typeof seedLearn>).lessons.at(-1);
    expect(lesson?.text).toBe("Position size before entry");
    expect(said({ kind: "lesson", track: "trading", text: "  " })).toContain("own words");
  });

  it("keeps no Arabic from a talk, so nothing of the Quran is typed", () => {
    const words = "الحمد";
    expect(said({ kind: "lesson", track: "trading", text: words })).toContain("Arabic");
    expect(said({ kind: "study", track: "trading", minutes: 10, text: words })).toContain("Arabic");
  });
});

describe("body", () => {
  it("logs a weight and a lift", () => {
    expect((planned({ kind: "weight", kg: 82.4 }).value as ReturnType<typeof emptyBody>).weights[0]).toEqual({ at: 1000, kg: 82.4 });
    const lift = planned({ kind: "lift", exercise: "Deadlift", kg: 100, reps: 8, sets: 3 });
    expect((lift.value as ReturnType<typeof emptyBody>).lifts[0]).toMatchObject({ exercise: "Deadlift", kg: 100, reps: 8, sets: 3, date: TODAY });
    expect(lift.said).toBe("Deadlift logged: 100 kilos, 8 reps, 3 sets.");
  });

  it("takes a bodyweight exercise with no kilos, one set unless the user says", () => {
    const lift = planned({ kind: "lift", exercise: "Pull ups", reps: 10 });
    expect(lift.said).toBe("Pull ups logged: 10 reps, 1 set.");
  });

  it("refuses what is not a weight or a lift", () => {
    expect(said({ kind: "weight", kg: 5 })).toContain("kilograms");
    expect(said({ kind: "lift", exercise: "", reps: 8 })).toContain("exercise");
    expect(said({ kind: "lift", exercise: "Row", reps: 8, kg: "heavy" })).toContain("could not be added");
    expect(said({ kind: "lift", exercise: "Row", reps: 8, kg: [80] })).toContain("could not be added");
    expect(said({ kind: "lift", exercise: "Row", reps: 8, kg: "0x10" })).toContain("could not be added");
  });

  it("rounds a lift's kilos, and takes a blank as bodyweight", () => {
    expect((planned({ kind: "lift", exercise: "Row", reps: 8, kg: 82.456 }).value as ReturnType<typeof emptyBody>).lifts[0].kg).toBe(82.5);
    expect((planned({ kind: "lift", exercise: "Row", reps: 8, kg: " " }).value as ReturnType<typeof emptyBody>).lifts[0].kg).toBe(0);
  });

  it("marks today's workout once", () => {
    const plan = planned({ kind: "workout_done" });
    expect(said({ kind: "workout_done" }, world({ body: plan.value as ReturnType<typeof emptyBody> }))).toContain("already");
  });
});

describe("money", () => {
  it("is refused until the user allows it, and leaves the user's money as it was", () => {
    const w = world({ moneyAllowed: false });
    expect(said({ kind: "money_in", who: "Client", amount: 12000 }, w)).toContain("switched off");
    expect(said({ kind: "owed", who: "Client", amount: 12000 }, w)).toContain("switched off");
  });

  it("logs money in, dirhams unless the user says", () => {
    const plan = planned({ kind: "money_in", who: "Acme Studio", amount: "12,000" });
    expect((plan.value as ReturnType<typeof emptyMoney>).entries[0]).toMatchObject({ from: "Acme Studio", cents: 1_200_000, currency: "AED", date: TODAY });
    expect(plan.said).toBe("AED 12000 from Acme Studio logged.");
    const dollars = planned({ kind: "money_in", who: "Corner Bakery", amount: 100, currency: "USD" });
    expect((dollars.value as ReturnType<typeof emptyMoney>).entries[0].currency).toBe("USD");
  });

  it("logs money owed, and asks again for a due date it cannot read", () => {
    const plan = planned({ kind: "owed", who: "Example Trading Co", amount: 300, due: "2026-11-05" });
    expect((plan.value as ReturnType<typeof emptyMoney>).owed[0]).toMatchObject({ who: "Example Trading Co", due: "2026-11-05" });
    expect(said({ kind: "owed", who: "Example Trading Co", amount: 300, due: "next week" })).toContain("due day");
  });

  it("reads a currency however it is cased, and refuses one it does not hold rather than calling it dirhams", () => {
    expect((planned({ kind: "money_in", who: "x", amount: 5, currency: "usd" }).value as ReturnType<typeof emptyMoney>).entries[0].currency).toBe("USD");
    expect(said({ kind: "money_in", who: "x", amount: 5, currency: "EUR" })).toContain("AED or USD");
  });

  it("refuses an amount that is not one", () => {
    for (const amount of ["lots", -5, 0, "1e5", null]) {
      expect(said({ kind: "money_in", who: "x", amount })).toContain("the amount");
    }
  });
});

describe("what it can never do", () => {
  it("answers anything else with a refusal", () => {
    for (const args of [null, [], "pay", { kind: "pay" }, { kind: "delete_all" }, {}]) {
      expect(planLog(args, world(), 1000).ok).toBe(false);
    }
  });
});
