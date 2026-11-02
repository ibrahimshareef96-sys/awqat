// What the app calls the device: an iPad is an iPad (even when its web view says Mac), everything else a phone.
import { describe, expect, it } from "vitest";
import { deviceWordFor } from "../src/ui/deviceWord.ts";

const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

describe("the device's name in the app's words", () => {
  it("is iPad on an iPad, whether its web view says iPad or Mac", () => {
    expect(deviceWordFor("ios", IPAD_DESKTOP, 5)).toBe("iPad");
    expect(deviceWordFor("ios", "Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X)", 5)).toBe("iPad");
  });

  it("is phone on an iPhone, on Android (foldables included) and in a browser", () => {
    expect(deviceWordFor("ios", IPHONE, 5)).toBe("phone");
    expect(deviceWordFor("android", "Mozilla/5.0 (Linux; Android 16; SM-F966B)", 5)).toBe("phone");
    expect(deviceWordFor("web", IPAD_DESKTOP, 0)).toBe("phone");
    expect(deviceWordFor("ios", IPAD_DESKTOP, 0)).toBe("phone");
  });
});
