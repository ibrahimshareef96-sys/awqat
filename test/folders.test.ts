// Where kept files live: covers with the app's data (backed up on iOS, as the user's own photos), the mushaf's pages and
// fonts out of the iCloud backup on iOS (they can be fetched again), and Android's folders as they always were.
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ platform: "ios" }));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => env.platform !== "web",
    getPlatform: () => env.platform,
    convertFileSrc: (path: string) => `capacitor://localhost/_capacitor_file_${path.replace(/^file:\/\//, "")}`,
  },
  CapacitorHttp: { get: vi.fn() },
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA", LibraryNoCloud: "LIBRARY_NO_CLOUD" },
  Filesystem: {
    getUri: async ({ directory }: { directory: string }) => ({
      uri: directory === "DATA" ? "file:///app/Documents/" : "file:///app/Library/NoCloud/",
    }),
  },
}));
vi.mock("@capacitor/camera", () => ({ Camera: {} }));

import { dataFileSrc, mushafDirectory, prepareFolders } from "../src/books/media.ts";

beforeEach(() => {
  env.platform = "ios";
});

describe("the folders kept files live in", () => {
  it("on iOS: the mushaf out of the iCloud backup, covers with the app's data", async () => {
    expect(mushafDirectory()).toBe("LIBRARY_NO_CLOUD");
    await prepareFolders();
    expect(dataFileSrc("mushaf-1421-fonts/p12.woff2"))
      .toBe("capacitor://localhost/_capacitor_file_/app/Library/NoCloud/mushaf-1421-fonts/p12.woff2");
    expect(dataFileSrc("covers/abc-1.jpg")).toBe("capacitor://localhost/_capacitor_file_/app/Documents/covers/abc-1.jpg");
  });

  it("on Android: the app's files folder for both, as before", () => {
    env.platform = "android";
    expect(mushafDirectory()).toBe("DATA");
  });

  it("gives no address for any other file", async () => {
    await prepareFolders();
    expect(dataFileSrc("mushaf-1421-pages/p12.json")).toBeNull();
    // The 1405 print's fonts (up to 0.12) are no longer given an address.
    expect(dataFileSrc("mushaf-fonts/p12.woff2")).toBeNull();
    expect(dataFileSrc("../secrets.txt")).toBeNull();
  });
});
