/**
 * The app's Talk calls to its own Worker (/talk/native/*): native HTTP (CapacitorHttp), so no browser rules apply and
 * no Origin header is sent, which is how the Worker tells the app from a web page. JSON both ways; the session goes as
 * a bearer token; a redirect is never followed, so the token never travels on to another address. Every answer is
 * checked for its shape before it is used, and a request still going after REQUEST_DEADLINE_MS counts as offline.
 */
import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import { SESSION_SHAPE } from "./session.ts";
import { cleanShown } from "./text.ts";

export const TALK_MESSAGES = {
  offline: "No connection. Check the internet and try again.",
  failed: "The talk did not start. Try again in a minute.",
};

/** A request still going after this is given up (the native request is left to finish on its own). */
export const REQUEST_DEADLINE_MS = 20000;
const ERROR_MAX = 300;
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A token as ElevenLabs gives one (a JWT): URL-safe and base64 characters and dots, at most 8 KB. */
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{1,8192}$/;
/** The variables a talk starts with, as the Worker sends them, and how long each may be. */
const VARIABLE_KEYS = new Set(["opening", "top3", "day_age", "channel", "secret__os_session"]);
const VARIABLE_MAX = 2000;

export type Post = (options: HttpOptions) => Promise<HttpResponse>;
export type Refused = { ok: false; status: number; error: string };
export type Answer<T> = ({ ok: true } & T) | Refused;
export interface Started {
  callId: string;
  conversationToken: string;
  variables: Record<string, string>;
}

const nativePost: Post = (options) => CapacitorHttp.post(options);

/** The answer, or null once the deadline passes. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** The Worker's own words for a refusal, cleaned (talk/text.ts) and cut short. */
function cleanError(value: unknown): string | null {
  const text = cleanShown(value, ERROR_MAX);
  return text === "" ? null : text;
}

type Reply = { status: number; body: Record<string, unknown> | null };

async function post(worker: string, action: string, data: Record<string, unknown>, session: string | null,
  send: Post, deadline: number): Promise<Reply | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (session !== null) headers.Authorization = `Bearer ${session}`;
  try {
    const response = await withDeadline(send({ url: `${worker}/talk/native/${action}`, headers, data,
      responseType: "json", connectTimeout: 10000, readTimeout: 15000, disableRedirects: true }), deadline);
    if (response === null) return null;
    const body = response.data;
    return { status: response.status, body: body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown> : null };
  } catch {
    return null;
  }
}

function refused(reply: Reply | null): Refused {
  if (reply === null) return { ok: false, status: 0, error: TALK_MESSAGES.offline };
  const own = reply.status >= 400 ? cleanError(reply.body?.error) : null;
  return { ok: false, status: reply.status, error: own ?? TALK_MESSAGES.failed };
}

const okReply = (reply: Reply | null): reply is Reply & { body: Record<string, unknown> } =>
  reply !== null && reply.status === 200 && reply.body?.ok === true;

/** The passphrase sent once; the session token the Worker answers, or why not. */
export async function signIn(worker: string, passphrase: string, send: Post = nativePost,
  deadline = REQUEST_DEADLINE_MS): Promise<Answer<{ token: string }>> {
  const reply = await post(worker, "signin", { passphrase }, null, send, deadline);
  if (!okReply(reply)) return refused(reply);
  const token = reply.body.token;
  return typeof token === "string" && SESSION_SHAPE.test(token) ? { ok: true, token } : refused({ ...reply, body: null });
}

function checkVariables(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const fine = entries.every(([key, text]) => VARIABLE_KEYS.has(key) && typeof text === "string" &&
    text.length <= VARIABLE_MAX);
  return fine ? Object.fromEntries(entries) as Record<string, string> : null;
}

/** A talk reserved on the Worker: its call id, ElevenLabs' WebRTC token and the variables it starts with. */
export async function startTalk(worker: string, session: string, send: Post = nativePost,
  deadline = REQUEST_DEADLINE_MS): Promise<Answer<Started>> {
  const reply = await post(worker, "start", {}, session, send, deadline);
  if (!okReply(reply)) return refused(reply);
  const { callId, conversationToken } = reply.body;
  const variables = checkVariables(reply.body.variables);
  if (typeof callId !== "string" || !CALL_ID.test(callId) || typeof conversationToken !== "string" ||
    !TOKEN_SHAPE.test(conversationToken) || variables === null) {
    return refused({ ...reply, body: null });
  }
  return { ok: true, callId, conversationToken, variables };
}

/**
 * Tells the Worker a talk connected (never given back) or is given back. Never throws; answers whether the Worker
 * took it, so a lost "connected" can be sent again (talk.ts) before the Worker's sweep gives a live talk back.
 */
export async function markTalk(worker: string, session: string, action: "abandon" | "connected", callId: string,
  send: Post = nativePost): Promise<boolean> {
  if (!CALL_ID.test(callId)) return false;
  return okReply(await post(worker, action, { callId }, session, send, REQUEST_DEADLINE_MS));
}

/** Ends the session on the Worker; true when it said so. */
export async function signOut(worker: string, session: string, send: Post = nativePost): Promise<boolean> {
  return okReply(await post(worker, "signout", {}, session, send, REQUEST_DEADLINE_MS));
}
