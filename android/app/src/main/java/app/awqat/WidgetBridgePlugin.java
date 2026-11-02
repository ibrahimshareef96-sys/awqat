package app.awqat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The app hands the home-screen widgets what they show. One method, one fixed place to keep it, the two widgets to
 * redraw: nothing from the page chooses a file name or a class.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    /** About 60 prayers and two days of lines come to a few kilobytes; past this it is not a snapshot. */
    private static final int SNAPSHOT_MAX = 100_000;

    @PluginMethod
    public void update(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null || snapshot.length() > SNAPSHOT_MAX) {
            call.reject("No snapshot, or one too large.");
            return;
        }
        String checked;
        try {
            JSONObject parsed = new JSONObject(snapshot);
            if (parsed.optInt("v") != 1) {
                call.reject("Not a snapshot this widget reads.");
                return;
            }
            // Written out afresh: this parser lets raw control characters through, and the XML file holding the snapshot
            // and the pending taps could not read itself back with one in it.
            checked = parsed.toString();
        } catch (JSONException e) {
            call.reject("Not a snapshot this widget reads.");
            return;
        }
        TodayWidget.save(getContext(), checked);
        TodayWidget.refreshAll(getContext());
        DhikrWidget.refreshAll(getContext());
        call.resolve();
    }
}
