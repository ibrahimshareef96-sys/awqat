// The app's calls to its Worker for Talk: native HTTP only, JSON, the session as a bearer token, never a redirect
// followed (so the token never travels on), and every answer checked for its shape before it is used.
import { describe, expect, it } from "vitest";
import type { HttpOptions, HttpResponse } from "@capacitor/core";
import { TALK_MESSAGES, markTalk, signIn, signOut, startTalk } from "../src/talk/worker.ts";

const WORKER = "https://os.example.com";
const SESSION = "s".repeat(43);
const TOKEN = "test-header.test-payload.test-signature";
const CALL = "0b7d3c62-4f1e-4c55-9a51-2d3e4f5a6b7c";
const VARIABLES = { opening: "Hi there.", top3: "1. x", day_age: "fresh", channel: "app", secret__os_session: "v".repeat(43) };

/** A fake native post: records what it was asked and answers as told. */
function poster(answer: Partial<HttpResponse> | Error | "never") {
  const asked: HttpOptions[] = [];
  const post = async (options: HttpOptions): Promise<HttpResponse> => {
    asked.push(options);
    if (answer === "never") return new Promise(() => undefined);
    if (answer instanceof Error) throw answer;
    return { status: 200, headers: {}, url: options.url, data: null, ...answer };
  };
  return { post, asked };
}

describe("signing in from the app", () => {
  it("posts the passphrase as JSON to the Worker's native sign-in, with redirects off and no session", async () => {
    const run = poster({ data: { ok: true, token: SESSION } });
    expect(await signIn(WORKER, "my passphrase", run.post)).toEqual({ ok: true, token: SESSION });
    expect(run.asked).toHaveLength(1);
    expect(run.asked[0]).toMatchObject({ url: `${WORKER}/talk/native/signin`, data: { passphrase: "my passphrase" },
      disableRedirects: true, headers: { "Content-Type": "application/json" } });
    expect(run.asked[0].headers?.Authorization).toBeUndefined();
  });

  it("says what the Worker said for a wrong passphrase or a lock, cleaned, and never a token of the wrong shape", async () => {
    expect(await signIn(WORKER, "x", poster({ status: 401, data: { ok: false, error: "That passphrase did not match. 4 tries left." } }).post))
      .toEqual({ ok: false, status: 401, error: "That passphrase did not match. 4 tries left." });
    const locked = await signIn(WORKER, "x", poster({ status: 429, data: { ok: false, error: "Too many\nwrong tries\u0007." } }).post);
    expect(locked).toEqual({ ok: false, status: 429, error: "Too many wrong tries ." });
    const spoof = [0x202e, 0x200b].map((code) => String.fromCodePoint(code)).join("");
    expect(await signIn(WORKER, "x", poster({ status: 401, data: { ok: false, error: `Wrong${spoof} try` } }).post))
      .toEqual({ ok: false, status: 401, error: "Wrong try" });
    expect(await signIn(WORKER, "x", poster({ data: { ok: true, token: "short" } }).post))
      .toEqual({ ok: false, status: 200, error: TALK_MESSAGES.failed });
    expect((await signIn(WORKER, "x", poster({ status: 500, data: "<html>" }).post)).ok).toBe(false);
  });

  it("says there is no connection when the post fails or never answers", async () => {
    expect(await signIn(WORKER, "x", poster(new Error("offline")).post)).toEqual({ ok: false, status: 0, error: TALK_MESSAGES.offline });
    expect(await signIn(WORKER, "x", poster("never").post, 20)).toEqual({ ok: false, status: 0, error: TALK_MESSAGES.offline });
  });

  it("does not follow a redirect: a 3xx is a failure, whatever it points to", async () => {
    const run = poster({ status: 302, headers: { Location: "https://evil.example/" }, data: "" });
    expect((await signIn(WORKER, "x", run.post)).ok).toBe(false);
    expect(run.asked).toHaveLength(1);
  });
});

describe("talking from the app", () => {
  it("starts with the session as a bearer token and takes the token, the call and the five variables", async () => {
    const run = poster({ data: { ok: true, callId: CALL, conversationToken: TOKEN, variables: VARIABLES, abandonWithin: 120 } });
    expect(await startTalk(WORKER, SESSION, run.post)).toEqual({ ok: true, callId: CALL, conversationToken: TOKEN,
      variables: VARIABLES });
    expect(run.asked[0]).toMatchObject({ url: `${WORKER}/talk/native/start`, data: {}, disableRedirects: true,
      headers: { Authorization: `Bearer ${SESSION}` } });
  });

  it("refuses an answer whose token, call or variables are not of their shape", async () => {
    for (const odd of [{ callId: "x" }, { conversationToken: "has space" }, { conversationToken: "x".repeat(8193) },
      { variables: [] }, { variables: { ...VARIABLES, top3: 5 } }, { variables: { ...VARIABLES, extra: "x" } },
      { variables: { ...VARIABLES, top3: "x".repeat(5000) } }]) {
      const answer = await startTalk(WORKER, SESSION, poster({ data: { ok: true, callId: CALL, conversationToken: TOKEN,
        variables: VARIABLES, ...odd } }).post);
      expect(answer).toEqual({ ok: false, status: 200, error: TALK_MESSAGES.failed });
    }
  });

  it("passes on the Worker's own refusal (signed out, busy, ElevenLabs) with its status", async () => {
    expect(await startTalk(WORKER, SESSION, poster({ status: 401, data: { ok: false, error: "You are signed out." } }).post))
      .toEqual({ ok: false, status: 401, error: "You are signed out." });
    expect(await startTalk(WORKER, SESSION, poster({ status: 502, data: { ok: false } }).post))
      .toEqual({ ok: false, status: 502, error: TALK_MESSAGES.failed });
  });

  it("tells the Worker a talk connected or was given back, saying whether it was taken, never throwing", async () => {
    const run = poster({ data: { ok: true } });
    expect(await markTalk(WORKER, SESSION, "connected", CALL, run.post)).toBe(true);
    expect(await markTalk(WORKER, SESSION, "abandon", CALL, poster(new Error("offline")).post)).toBe(false);
    expect(await markTalk(WORKER, SESSION, "abandon", "not-a-call", run.post)).toBe(false);
    expect(run.asked.map((o) => [o.url, o.data])).toEqual([[`${WORKER}/talk/native/connected`, { callId: CALL }]]);
  });

  it("signs out with the session, saying whether the Worker took it", async () => {
    const run = poster({ data: { ok: true } });
    expect(await signOut(WORKER, SESSION, run.post)).toBe(true);
    expect(run.asked[0]).toMatchObject({ url: `${WORKER}/talk/native/signout`, headers: { Authorization: `Bearer ${SESSION}` } });
    expect(await signOut(WORKER, SESSION, poster(new Error("offline")).post)).toBe(false);
  });
});
