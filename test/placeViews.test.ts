// What Home and Settings say about the place and the iqama: a card while the place is only guessed, a form for typed
// coordinates, and five iqama fields that show what is in use.
import { describe, expect, it } from "vitest";
import { DEFAULT_PLACE } from "../src/place.ts";
import { defaultSettings } from "../src/settings.ts";
import { homeLinks, iqamaFields, placeCard, placeForm, type ViewModel } from "../src/ui/views.ts";
import { DUBAI } from "./fixtures/places.ts";

const model = (over: Partial<ViewModel>): ViewModel =>
  ({ settings: { ...defaultSettings(), setupDone: true }, place: DEFAULT_PLACE, busy: false, ...over }) as ViewModel;

describe("the place card on Home", () => {
  it("asks for a place once setup is past and the times are only Makkah's", () => {
    const html = placeCard(model({}));
    expect(html).toContain("SET YOUR PLACE");
    expect(html).toContain("Makkah");
    expect(html).toContain('data-action="locate"');
  });

  it("is not there before setup, or once a place is known", () => {
    expect(placeCard(model({ settings: defaultSettings() }))).toBe("");
    expect(placeCard(model({ place: DUBAI }))).toBe("");
  });
});

describe("Home's row of screens", () => {
  it("offers Work and Inbox only with the user's own server set up", () => {
    const screens = (worker: string) => homeLinks(worker).map(([go]) => go);
    expect(screens("")).not.toContain("work");
    expect(screens("")).not.toContain("inbox");
    expect(screens("")).toContain("money");
    expect(screens("https://os.example.com")).toEqual(expect.arrayContaining(["work", "inbox"]));
  });
});

describe("Settings", () => {
  it("offers typed coordinates, with no city built in", () => {
    const html = placeForm(model({}));
    expect(html).toContain('data-form="place-pin"');
    expect(html).toContain('name="lat"');
    expect(html).toContain('name="lng"');
    expect(html).not.toMatch(/Dubai|pin-dubai/);
    // A text keyboard: a decimal keypad has no minus on some phones. Every box has a visible label.
    expect(html).not.toContain("inputmode=");
    expect(html.match(/<label class="small" for="place-/g)).toHaveLength(3);
    expect(html).not.toContain('role="alert"');
  });

  it("says inside the form why typed coordinates were not taken", () => {
    const html = placeForm(model({ placeError: "That is not a place on Earth." }));
    expect(html).toContain('<p class="small" role="alert">That is not a place on Earth.</p>');
  });

  it("shows the iqama minutes in use for each prayer", () => {
    const settings = { ...defaultSettings(), iqama: { ...defaultSettings().iqama, asr: 33 } };
    const html = iqamaFields(model({ settings }));
    expect(html.match(/data-iqama=/g)).toHaveLength(5);
    expect(html).toContain('data-iqama="asr" value="33"');
  });
});
