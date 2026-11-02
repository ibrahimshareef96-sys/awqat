package app.awqat;

import android.annotation.SuppressLint;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * "Talk to Awqat" in Quick Settings: a tap opens the app on the Talk sheet, through the same checked link as a widget,
 * and the shade closes. A button, not a switch, so the tile is always shown at rest. On a locked phone the system asks
 * for the unlock first.
 */
public class TalkTileService extends TileService {
    /** Its own request code, apart from the widgets'. */
    private static final int REQUEST_CODE = 60;

    @Override
    public void onStartListening() {
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(Tile.STATE_INACTIVE);
        tile.updateTile();
    }

    @Override
    public void onClick() {
        if (isLocked()) unlockAndRun(this::openTalk);
        else openTalk();
    }

    /** Android 14 takes only a PendingIntent here; before it, only an Intent (deprecated, and the only way there). */
    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    private void openTalk() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(WidgetIntents.open(this, "talk", REQUEST_CODE));
        } else {
            startActivityAndCollapse(WidgetIntents.link(this, "talk"));
        }
    }
}
