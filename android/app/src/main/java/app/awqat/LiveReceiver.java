package app.awqat;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The "+1" on the dhikr card and the swipe that dismisses a card. Runs with the app closed and never opens it. */
public class LiveReceiver extends BroadcastReceiver {
    private static final String ACTION_TAP = "app.awqat.live.TAP";
    private static final String ACTION_DISMISSED = "app.awqat.live.DISMISSED";
    private static final String EXTRA_KEY = "key";
    private static final String EXTRA_ID = "id";
    private static final String EXTRA_IDENTITY = "identity";

    static PendingIntent tap(Context context, String key, int requestCode) {
        Intent intent = new Intent(context, LiveReceiver.class).setAction(ACTION_TAP).putExtra(EXTRA_KEY, key)
                .addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Carries what the card showed: by the time this arrives, a newer item may be the one on record. */
    static PendingIntent dismissed(Context context, LiveData.Item item, int requestCode) {
        Intent intent = new Intent(context, LiveReceiver.class).setAction(ACTION_DISMISSED).putExtra(EXTRA_ID, item.id)
                .putExtra(EXTRA_IDENTITY, LiveData.identity(item));
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_TAP.equals(action)) onTap(context, intent.getStringExtra(EXTRA_KEY));
        else if (ACTION_DISMISSED.equals(action)) {
            onDismissed(context, intent.getStringExtra(EXTRA_ID), intent.getStringExtra(EXTRA_IDENTITY));
        }
    }

    private static void onTap(Context context, String key) {
        synchronized (LiveStore.LOCK) {
            LiveData.Item item = LiveStore.item(context, LiveData.DHIKR);
            if (key == null || item == null || !item.counts() || !key.equals(item.key)) return;
            int shown = LiveData.shownCount(item.count, LiveStore.pendingFor(context, key), item.of);
            if (LiveData.canTap(shown, item.of)) LiveStore.addTap(context, key);
            LiveNotifier.refreshCount(context, key);
        }
        DhikrWidget.refreshAll(context);
    }

    /** A card up again means a show got in first: marking it dismissed now would freeze it on screen. */
    private static void onDismissed(Context context, String id, String identity) {
        if (!LiveData.isId(id) || identity == null) return;
        synchronized (LiveStore.LOCK) {
            if (!LiveNotifier.isUp(context, id)) LiveStore.setDismissed(context, id, identity);
        }
    }
}
