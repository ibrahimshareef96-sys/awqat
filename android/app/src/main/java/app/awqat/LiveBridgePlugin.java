package app.awqat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the app wants live on the lock screen (docs/live-surfaces.md). The page decides and this only draws, and takes
 * back the taps made while the app was away. `show` is called often and posts nothing when the card would not change.
 */
@CapacitorPlugin(name = "LiveBridge")
public class LiveBridgePlugin extends Plugin {
    @PluginMethod
    public void available(PluginCall call) {
        call.resolve(new JSObject().put("live", LiveNotifier.allowed(getContext())));
    }

    @PluginMethod
    public void show(PluginCall call) {
        LiveData.Item item = LiveStore.parseItem(call.getData());
        if (item == null) {
            call.reject("Not an item this can show.");
            return;
        }
        // A refusal, not a quiet success: the page remembers what it sent, and must send it again once they are allowed.
        if (!LiveNotifier.allowed(getContext())) {
            call.reject("Notifications are off.");
            return;
        }
        LiveNotifier.show(getContext(), item);
        call.resolve();
    }

    @PluginMethod
    public void end(PluginCall call) {
        String id = call.getString("id");
        if (!LiveData.isId(id)) {
            call.reject("Not an item this can end.");
            return;
        }
        LiveNotifier.end(getContext(), id);
        call.resolve();
    }

    /** The widgets are not redrawn here: the app's next snapshot holds the same count, and a redraw now would dip. */
    @PluginMethod
    public void drain(PluginCall call) {
        JSArray taps = new JSArray();
        for (LiveData.Tap tap : LiveStore.drain(getContext())) {
            taps.put(new JSObject().put("key", tap.key).put("n", tap.n));
        }
        call.resolve(new JSObject().put("taps", taps));
    }
}
