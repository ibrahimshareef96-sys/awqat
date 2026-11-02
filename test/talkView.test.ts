// @vitest-environment happy-dom
// The Talk sheet: the passphrase form the first time, then the orb, what the agent is doing, the last words said,
// mute and End. During a talk the sheet is updated in place (the same elements), so focus and a screen reader's place
// are kept; only a change of layout (form to talk) redraws its body.
import { beforeEach, describe, expect, it } from "vitest";
import { paintTalk, talkSheet, type TalkModel } from "../src/ui/talkView.ts";

const WORKER = "https://os.example.com";
const base: TalkModel = { worker: WORKER, phase: "idle", message: "", caption: "", muted: false, logged: "", device: "phone" };

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the Talk sheet", () => {
  it("asks for the passphrase in a password field the system can fill, once", () => {
    const html = talkSheet({ ...base, phase: "signin" });
    expect(html).toContain('id="talk-signin"');
    expect(html).toMatch(/<input[^>]+type="password"[^>]+autocomplete="current-password"/);
    expect(html).toContain('name="passphrase"');
    expect(html).toContain("This phone remembers it for 30 days.");
    expect(html).toContain("os.example.com");
    expect(html).toContain("data-autofocus");
  });

  it("shows what the Worker said about a wrong passphrase, and holds the button while it checks", () => {
    expect(talkSheet({ ...base, phase: "signin", message: "That passphrase did not match. 4 tries left." }))
      .toContain("That passphrase did not match. 4 tries left.");
    expect(talkSheet({ ...base, phase: "signing" })).toMatch(/<button type="submit"[^>]*disabled[^>]*>Checking/);
  });

  it("offers Talk and Close when no talk is going", () => {
    const html = talkSheet({ ...base, message: "Talk ended." });
    expect(html).toMatch(/data-action="talk-start"[^>]*>Talk</);
    expect(html).toContain('data-go="close"');
    expect(html).toContain("Talk ended.");
  });

  it("while connecting the main button cancels, and mute waits for the talk", () => {
    const html = talkSheet({ ...base, phase: "connecting", message: "Connecting." });
    expect(html).toMatch(/data-action="talk-end"[^>]*>Cancel</);
    expect(html).toMatch(/id="talk-mute"[^>]*disabled/);
  });

  it("during a talk shows the agent's state and the last words, escaped, with mute and End", () => {
    const html = talkSheet({ ...base, phase: "listening", message: "Listening.", caption: "You: <b>hi</b>" });
    expect(html).toContain('data-state="listening"');
    expect(html).toContain("You: &lt;b&gt;hi&lt;/b&gt;");
    expect(html).toMatch(/data-action="talk-end"[^>]*>End</);
    expect(html).toMatch(/id="talk-mute"[^>]*aria-pressed="false"/);
    expect(html).not.toMatch(/id="talk-mute"[^>]*disabled/);
  });

  it("without a Worker's address it sends the user to Settings", () => {
    const html = talkSheet({ ...base, worker: "" });
    expect(html).toContain('data-go="settings"');
    expect(html).not.toContain("talk-signin");
  });
});

describe("updating the sheet during a talk", () => {
  it("changes words, orb and buttons in place, keeping the same elements", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "connecting", message: "Connecting." });
    const status = document.getElementById("talk-status");
    const main = document.getElementById("talk-main");
    paintTalk({ ...base, phase: "speaking", message: "Speaking.", caption: "Two meetings." });
    expect(document.getElementById("talk-status")).toBe(status);
    expect(status?.textContent).toBe("Speaking.");
    expect(document.getElementById("talk-caption")?.textContent).toBe("Two meetings.");
    expect(document.querySelector(".talk-orb")?.getAttribute("data-state")).toBe("speaking");
    expect(main?.textContent).toBe("End");
    expect(main?.getAttribute("data-action")).toBe("talk-end");
    paintTalk({ ...base, phase: "speaking", message: "Speaking.", muted: true });
    expect(document.getElementById("talk-mute")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("redraws the body when the layout changes, from the form to a talk and back", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "signin" });
    paintTalk({ ...base, phase: "connecting", message: "Connecting." });
    expect(document.getElementById("talk-signin")).toBeNull();
    expect(document.getElementById("talk-status")?.textContent).toBe("Connecting.");
    paintTalk({ ...base, phase: "signin", message: "You are signed out." });
    expect(document.getElementById("talk-signin")).not.toBeNull();
    expect(document.body.textContent).toContain("You are signed out.");
  });

  it("does nothing when the sheet is not open", () => {
    expect(() => paintTalk({ ...base, phase: "listening" })).not.toThrow();
  });
});

describe("the speaking orb's place", () => {
  it("is one canvas, hidden from screen readers (the words beside it say the state), marked with the phase", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "listening" });
    const canvas = document.querySelector("canvas.voice-orb");
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".talk-orb")?.getAttribute("data-state")).toBe("listening");
    paintTalk({ ...base, phase: "speaking" });
    expect(document.querySelector(".talk-orb")?.getAttribute("data-state")).toBe("speaking");
  });
});
