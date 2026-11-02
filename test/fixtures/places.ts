// A place the tests work out prayer times for: the city centre of Dubai, pinned, on the clock the suite runs on
// (`TZ=Asia/Dubai`). Any city would do; the expected times in the tests are for this one.
import type { Place } from "../../src/place.ts";

export const DUBAI: Place = { lat: 25.2048, lng: 55.2708, label: "Dubai", source: "pinned", at: 0, tz: "Asia/Dubai" };
