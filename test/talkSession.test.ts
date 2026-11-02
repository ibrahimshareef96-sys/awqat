// The app's Talk session: a bearer token for one Worker, kept in a file the system never backs up, and never sent to
// any other Worker than the one it came from.
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ map: new Map<string, string>(), failWrite: false, failRead: false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { LibraryNoCloud: "LIBRARY_NO_CLOUD", Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    stat: async ({ path, directory }: { path: string; directory: string }) => {
      if (files.failRead) throw new Error("disk is locked");
      if (!files.map.has(`${directory}/${path}`)) throw new Error("File does not exist");
      return {};
    },
    readFile: async ({ path, directory }: { path: string; directory: string }) => ({ data: files.map.get(`${directory}/${path}`) }),
    writeFile: async ({ path, directory, data }: { path: string; directory: string; data: string }) => {
      if (files.failWrite) throw new Error("disk is full");
      files.map.set(`${directory}/${path}`, data);
    },
    deleteFile: async ({ path, directory }: { path: string; directory: string }) => {
      if (!files.map.delete(`${directory}/${path}`)) throw new Error("File does not exist");
    },
  },
}));

import { clearSession, parseSession, readSession, sessionToken, writeSession } from "../src/talk/session.ts";

const WORKER = "https://os.example.com";
const TOKEN = "a".repeat(43);

beforeEach(() => {
  files.map.clear();
  files.failWrite = false;
  files.failRead = false;
});

describe("reading a kept session", () => {
  it("takes only a session of the right shape for an https Worker", () => {
    expect(parseSession(JSON.stringify({ v: 1, worker: WORKER, token: TOKEN }))).toEqual({ worker: WORKER, token: TOKEN });
    for (const bad of [null, "", "not json", "[]", JSON.stringify({ v: 2, worker: WORKER, token: TOKEN }),
      JSON.stringify({ v: 1, worker: "http://os.example.com", token: TOKEN }),
      JSON.stringify({ v: 1, worker: `${WORKER}/talk`, token: TOKEN }),
      JSON.stringify({ v: 1, worker: WORKER, token: "short" }),
      JSON.stringify({ v: 1, worker: WORKER, token: `${TOKEN}!` })]) {
      expect(parseSession(bad)).toBeNull();
    }
  });

  it("hands the token only to the Worker it came from", () => {
    const session = { worker: WORKER, token: TOKEN };
    expect(sessionToken(session, WORKER)).toBe(TOKEN);
    expect(sessionToken(session, "https://other.example.com")).toBeNull();
    expect(sessionToken(null, WORKER)).toBeNull();
  });
});

describe("the session file", () => {
  it("is written to the folder iOS never backs up, read back, and removed on sign out", async () => {
    expect(await readSession()).toBeNull();
    expect(await writeSession({ worker: WORKER, token: TOKEN })).toBe(true);
    expect([...files.map.keys()]).toEqual(["LIBRARY_NO_CLOUD/voice/session.json"]);
    expect(await readSession()).toEqual({ worker: WORKER, token: TOKEN });
    await clearSession();
    expect(files.map.size).toBe(0);
    await clearSession();
  });

  it("says false when it cannot be written, and reads nothing from a file it cannot read", async () => {
    files.failWrite = true;
    expect(await writeSession({ worker: WORKER, token: TOKEN })).toBe(false);
    files.failWrite = false;
    await writeSession({ worker: WORKER, token: TOKEN });
    files.failRead = true;
    expect(await readSession()).toBeNull();
  });

  it("never writes a session of the wrong shape", async () => {
    expect(await writeSession({ worker: "http://x.example.com", token: TOKEN })).toBe(false);
    expect(await writeSession({ worker: WORKER, token: "short" })).toBe(false);
    expect(files.map.size).toBe(0);
  });
});
