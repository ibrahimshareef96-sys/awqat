// The Worker's address for the voice page: an https origin only, typed or built in.
import { describe, expect, it } from "vitest";
import { cleanWorkerUrl, talkPage, workerUrl } from "../src/voice.ts";
import { parseSettings } from "../src/settings.ts";

describe("the Worker's address", () => {
  it("keeps only the https origin of what was typed", () => {
    expect(cleanWorkerUrl("https://os.example.com/talk?x=1")).toBe("https://os.example.com");
    expect(cleanWorkerUrl("os.example.com")).toBe("https://os.example.com");
    expect(cleanWorkerUrl("  https://os.example.com  ")).toBe("https://os.example.com");
  });

  it("refuses plain http, passwords, hosts without a dot, and anything else", () => {
    for (const bad of ["http://os.example.com", "https://me:pw@os.example.com", "https://localhost", "",
      "https://192.168.1.4", "https://worker.local",
      "javascript:alert(1)", "https://a b.example.com", 7, `https://${"a".repeat(200)}.example.com`]) {
      expect(cleanWorkerUrl(bad)).toBe("");
    }
  });

  it("uses the typed address, and the talk page under it", () => {
    expect(workerUrl("https://mine.example.com")).toBe("https://mine.example.com");
    expect(talkPage("https://mine.example.com")).toBe("https://mine.example.com/talk");
  });

  it("keeps a typed address in Settings only when it is one", () => {
    expect(parseSettings(JSON.stringify({ voiceUrl: "https://mine.example.com/x" })).voiceUrl).toBe("https://mine.example.com");
    expect(parseSettings(JSON.stringify({ voiceUrl: "http://mine.example.com" })).voiceUrl).toBe("");
  });
});
