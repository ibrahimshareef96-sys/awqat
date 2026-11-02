/** The small touch under the thumb: a light tap for each count, a firmer one when a dhikr is finished. Never fails a tap. */
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { isNative } from "../device.ts";

export function feelCount(finished: boolean): void {
  if (!isNative()) return;
  void Haptics.impact({ style: finished ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => undefined);
}
