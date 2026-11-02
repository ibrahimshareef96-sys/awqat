package app.awqat;

import android.content.Context;
import java.time.ZonedDateTime;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The snapshot as the app last saved it, for the widgets that read more of it than TodayWidget does (docs/live-surfaces.md).
 * Read defensively: a snapshot that does not read is the calm "open the app" state, never a crash.
 */
final class SnapshotJson {
    private SnapshotJson() {}

    /** The snapshot, or null when there is none yet or it is not one these widgets read. */
    static JSONObject read(Context context) {
        String json = context.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE).getString(TodayWidget.KEY, null);
        if (json == null) return null;
        try {
            JSONObject root = new JSONObject(json);
            return root.optInt("v") == 1 ? root : null;
        } catch (JSONException e) {
            return null;
        }
    }

    /** The place is only guessed: nothing from the prayer times is shown, and the widget says "Set your place". */
    static boolean placeUnset(JSONObject root) {
        return root != null && "unset".equals(root.optString("place"));
    }

    /** Now, on the clock of the place the snapshot was made for. */
    static ZonedDateTime now(JSONObject root) {
        return ZonedDateTime.now(TodayWidget.zone(root == null ? null : root.optString("tz", null)));
    }
}
