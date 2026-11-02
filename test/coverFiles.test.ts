// Cover files on the phone: which ones the start-up clean-up may delete, and which camera copies are the app's own.
import { describe, expect, it } from "vitest";
import { cameraTempUri, staleCovers } from "../src/books/coverFiles.ts";

const NOW = Date.UTC(2026, 9, 23, 6, 0);
const HOUR = 60 * 60 * 1000;

describe("the start-up clean-up", () => {
  const files = [
    { name: "kept.jpg", type: "file", mtime: NOW - HOUR },
    { name: "orphan.jpg", type: "file", mtime: NOW - HOUR },
    { name: "fresh.jpg", type: "file", mtime: NOW - 60_000 },
    { name: "no-time.jpg", type: "file", mtime: undefined },
    { name: "odd name.jpg", type: "file", mtime: NOW - HOUR },
    { name: "sub", type: "directory", mtime: NOW - HOUR },
  ];

  it("deletes only old, unused files named like a cover", () => {
    expect(staleCovers(files, new Set(["covers/kept.jpg"]), NOW, 10 * 60_000)).toEqual(["covers/orphan.jpg"]);
  });

  it("treats a file with no modified time as new", () => {
    expect(staleCovers(files, new Set(), NOW, 10 * 60_000)).not.toContain("covers/no-time.jpg");
  });
});

describe("the camera's own copies", () => {
  it("recognises a copy in the app's private folders, with or without file://", () => {
    expect(cameraTempUri("/data/user/0/app.awqat/cache/IMG_1.jpg"))
      .toBe("file:///data/user/0/app.awqat/cache/IMG_1.jpg");
    expect(cameraTempUri("file:///storage/emulated/0/Android/data/app.awqat/files/Pictures/a.jpg"))
      .toBe("file:///storage/emulated/0/Android/data/app.awqat/files/Pictures/a.jpg");
  });

  it("recognises a copy in the app's own temporary folder on an iPhone or iPad (and the simulator)", () => {
    const app = "/var/mobile/Containers/Data/Application/0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
    expect(cameraTempUri(`file://${app}/tmp/photo-1.jpg`)).toBe(`file://${app}/tmp/photo-1.jpg`);
    expect(cameraTempUri(`file:///private${app}/tmp/photo-2.jpg`)).toBe(`file:///private${app}/tmp/photo-2.jpg`);
    const sim = "/Users/me/Library/Developer/CoreSimulator/Devices/9F8E7D6C-5B4A-4938-A7B6-C5D4E3F2A1B0/data/Containers" +
      "/Data/Application/1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D";
    expect(cameraTempUri(`file://${sim}/tmp/photo-3.jpg`)).toBe(`file://${sim}/tmp/photo-3.jpg`);
  });

  it("never touches an iOS app's documents (saved covers), or a temporary folder that is not an app's", () => {
    const app = "/var/mobile/Containers/Data/Application/0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
    for (const uri of [
      `file://${app}/Documents/covers/abc.jpg`,
      `file://${app}/Library/NoCloud/mushaf-fonts/p1.woff2`,
      `file://${app}/tmp/../Documents/covers/abc.jpg`,
      "file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.JPG",
      "file:///var/mobile/Containers/Data/Application/not-a-uuid/tmp/a.jpg",
      "file:///tmp/photo-1.jpg",
      `file://${app}/tmp/`,
      `file://${app}/tmp/sub/photo.jpg`,
      `file://${app}/tmp/notes.txt`,
    ]) expect(cameraTempUri(uri)).toBeNull();
  });

  it("never touches the user's gallery, other apps, saved covers, or tricky paths", () => {
    for (const uri of [
      "/storage/emulated/0/DCIM/Camera/IMG_1.jpg",
      "content://media/external/images/media/12",
      "/data/user/0/com.other.app/cache/a.jpg",
      "/data/user/0/app.awqat/files/covers/abc.jpg",
      "/data/user/0/app.awqat/cache/../files/covers/abc.jpg",
      "/data/user/0/app.awqat/cache/%2e%2e/files/x.jpg",
      "/data/user/0/app.awqat.evil/cache/a.jpg",
      // An empty part would slip past the covers folder's name, and a folder or another kind of file is never deleted.
      "/data/user/0/app.awqat/files//covers/x.jpg",
      "/data/user/0/app.awqat/files/",
      "/data/user/0/app.awqat/cache/notes.txt",
    ]) expect(cameraTempUri(uri)).toBeNull();
  });
});
