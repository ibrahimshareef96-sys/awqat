package app.awqat;

import android.content.Intent;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins (the widgets' bridge and the live cards') are registered before the bridge starts.
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(LiveBridgePlugin.class);
        // Brought back after Android ended the app, or reopened from Recents: the widget tap that first opened it is not
        // a new tap, so it must not move the screen again.
        Intent launch = getIntent();
        boolean fromRecents = launch != null && (launch.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        if (launch != null && (savedInstanceState != null || fromRecents)) launch.setData(null);
        // After super: BridgeActivity swaps the splash theme for the app theme first. Then the sky runs behind the
        // status and navigation bars, and the page pads itself with the safe-area insets.
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }
}
