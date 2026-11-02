package app.awqat;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The pending taps and the live items, in the same SharedPreferences as the snapshot. Taps arrive on the main thread and
 * the bridge drains them on its own, so everything that reads and then writes takes the one lock.
 */
final class LiveStore {
    private static final String TAPS = "pendingTaps";
    private static final String ITEM = "live_item_";
    private static final String UP = "live_up_";
    private static final String DISMISSED = "live_dismissed_";
    private static final int TEXT_MAX = 120;
    private static final int KEY_MAX = 256;
    /** Shared with the notifier, whose read, decide and post has to be one step too. */
    static final Object LOCK = new Object();

    private LiveStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE);
    }

    static List<LiveData.Tap> taps(Context context) {
        synchronized (LOCK) {
            return parseTaps(prefs(context).getString(TAPS, null));
        }
    }

    static int pendingFor(Context context, String key) {
        return LiveData.pendingFor(taps(context), key);
    }

    static void addTap(Context context, String key) {
        synchronized (LOCK) {
            List<LiveData.Tap> next = LiveData.addTap(parseTaps(prefs(context).getString(TAPS, null)), key);
            prefs(context).edit().putString(TAPS, tapsJson(next)).apply();
        }
    }

    /**
     * Hands over the taps and clears them; written before it returns, so a crash cannot count them twice. If the write
     * fails (a full disk) they stay for the next time and none are handed over now.
     */
    static List<LiveData.Tap> drain(Context context) {
        synchronized (LOCK) {
            List<LiveData.Tap> taps = parseTaps(prefs(context).getString(TAPS, null));
            return prefs(context).edit().remove(TAPS).commit() ? taps : Collections.<LiveData.Tap>emptyList();
        }
    }

    private static List<LiveData.Tap> parseTaps(String json) {
        if (json == null) return Collections.emptyList();
        List<LiveData.Tap> taps = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject tap = array.getJSONObject(i);
                String key = tap.optString("key");
                int n = tap.optInt("n");
                if (!key.isEmpty() && n > 0) taps.add(new LiveData.Tap(key, n));
            }
        } catch (JSONException e) {
            // Only this class writes it, so a broken list is a damaged file: start again rather than crash on every tap.
            return Collections.emptyList();
        }
        return taps;
    }

    private static String tapsJson(List<LiveData.Tap> taps) {
        JSONArray array = new JSONArray();
        try {
            for (LiveData.Tap tap : taps) {
                array.put(new JSONObject().put("key", tap.key).put("n", tap.n));
            }
        } catch (JSONException e) {
            throw new IllegalStateException("A tap could not be written", e);
        }
        return array.toString();
    }

    /** An item from the page or from the store; lines are cut to fit, and null when it cannot be one. */
    static LiveData.Item parseItem(JSONObject raw) {
        String key = raw.optString("key");
        if (key.length() > KEY_MAX) return null;
        LiveData.Item item = new LiveData.Item(raw.optString("id"),
                TodayWidgetData.clip(raw.optString("title"), TEXT_MAX),
                TodayWidgetData.clip(raw.optString("detail"), TEXT_MAX),
                Math.max(0L, raw.optLong("endsAt")), Math.max(0L, raw.optLong("startedAt")),
                Math.max(0, raw.optInt("count")), Math.max(0, raw.optInt("of")), key, raw.optString("link"));
        return item.isValid() ? item : null;
    }

    private static String itemJson(LiveData.Item item) {
        try {
            return new JSONObject().put("id", item.id).put("title", item.title).put("detail", item.detail)
                    .put("endsAt", item.endsAt).put("startedAt", item.startedAt).put("count", item.count)
                    .put("of", item.of).put("key", item.key).put("link", item.link).toString();
        } catch (JSONException e) {
            throw new IllegalStateException("An item could not be written", e);
        }
    }

    /** The item last shown under this id: a tap has to count on from it with the app closed. */
    static LiveData.Item item(Context context, String id) {
        String json = prefs(context).getString(ITEM + id, null);
        if (json == null) return null;
        try {
            return parseItem(new JSONObject(json));
        } catch (JSONException e) {
            return null;
        }
    }

    static String upFingerprint(Context context, String id) {
        return prefs(context).getString(UP + id, null);
    }

    static void savePosted(Context context, LiveData.Item item, String fingerprint) {
        prefs(context).edit().putString(ITEM + item.id, itemJson(item)).putString(UP + item.id, fingerprint)
                .remove(DISMISSED + item.id).apply();
    }

    /** The app's numbers changed but the card's did not: later taps must still count from the app's. */
    static void saveItem(Context context, LiveData.Item item) {
        prefs(context).edit().putString(ITEM + item.id, itemJson(item)).apply();
    }

    static String dismissed(Context context, String id) {
        return prefs(context).getString(DISMISSED + id, "");
    }

    static void setDismissed(Context context, String id, String identity) {
        prefs(context).edit().putString(DISMISSED + id, identity).remove(UP + id).apply();
    }

    static void forget(Context context, String id) {
        prefs(context).edit().remove(ITEM + id).remove(UP + id).remove(DISMISSED + id).apply();
    }
}
