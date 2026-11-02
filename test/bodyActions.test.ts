// @vitest-environment happy-dom
// Body's actions: the health store is looked for again after it was missing, a reading that fails for one kind keeps
// the last good one, and a weekly plan that is not a number from 1 to 14 is asked for again.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(async () => true),
  available: vi.fn(),
  read: vi.fn(),
  denied: vi.fn(async () => [] as string[]),
}));
vi.mock("../src/store.ts", () => ({ KEYS: { body: "body" }, write: mocks.write, read: vi.fn(), keepAside: vi.fn() }));
vi.mock("../src/device.ts", () => ({ isNative: () => true }));
vi.mock("../src/body/health.ts", () => ({
  healthAvailable: mocks.available, readHealth: mocks.read, deniedTypes: mocks.denied, connectHealth: vi.fn(),
  openHealthSettings: vi.fn(),
}));

import { emptyBody, setConnected, setTarget } from "../src/body/body.ts";
import { hooks, state } from "../src/app/state.ts";
import { BODY_MESSAGES, addTypedWeight, openBody, readBody, setWeeklyTarget } from "../src/app/bodyActions.ts";

const NOW_ISO = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  state.body = setConnected(emptyBody(), true);
  state.health = { available: null, denied: [], raw: null, summary: null, readAt: null, reading: false };
  state.busy = false;
  state.notice = "";
  state.blocked.clear();
  hooks.render = vi.fn();
  hooks.softRender = vi.fn();
  hooks.renderOverlay = vi.fn();
  document.body.innerHTML = `<div id="live"></div>`;
  mocks.read.mockResolvedValue({ weight: [], steps: [{ startDate: NOW_ISO, value: 1200 }], sleep: [], workouts: [] });
});

describe("finding the health store", () => {
  it("looks again once it was missing, so an install or update counts without a restart", async () => {
    mocks.available.mockResolvedValueOnce({ available: false, reason: "not installed" });
    await openBody();
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.available.mockResolvedValueOnce({ available: true });
    await openBody();
    expect(mocks.available).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("asks only once when it is there", async () => {
    mocks.available.mockResolvedValue({ available: true });
    await openBody();
    await openBody();
    expect(mocks.available).toHaveBeenCalledTimes(1);
  });
});

describe("readings", () => {
  it("keeps the last good steps when a read gives none, and lets them go when steps are no longer allowed", async () => {
    state.health.available = { available: true };
    await readBody();
    mocks.read.mockResolvedValueOnce({ weight: [], steps: null, sleep: [], workouts: [] });
    await readBody();
    expect(state.health.raw?.steps).toHaveLength(1);
    mocks.read.mockResolvedValueOnce({ weight: [], steps: null, sleep: [], workouts: [] });
    mocks.denied.mockResolvedValueOnce(["steps"]);
    await readBody();
    expect(state.health.raw?.steps).toBeNull();
  });
});

describe("typed weights and the plan", () => {
  it("asks again for a plan that is not 1 to 14, and keeps the one there was", async () => {
    state.body = setTarget(state.body, 4);
    await setWeeklyTarget("15");
    expect(state.notice).toBe(BODY_MESSAGES.badTarget);
    expect(state.body.weeklyTarget).toBe(4);
    expect(mocks.write).not.toHaveBeenCalled();
    await setWeeklyTarget(" ");
    expect(state.body.weeklyTarget).toBeNull();
  });

  it("adds a typed weight while drawn busy, and asks again for one that is not a weight", async () => {
    await addTypedWeight("eighty");
    expect(state.notice).toBe(BODY_MESSAGES.badWeight);
    await addTypedWeight("81.7");
    expect(state.body.weights[0].kg).toBe(81.7);
    expect(state.busy).toBe(false);
    expect(hooks.render).toHaveBeenCalled();
  });
});
