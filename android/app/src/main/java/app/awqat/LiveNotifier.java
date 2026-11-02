package app.awqat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * Draws the live items as ongoing notifications that ask to be promoted (Android 16's Live Updates). It decides nothing
 * about prayers: it posts what the app gave it, or the iqama the snapshot names, and only when the card would change.
 */
final class LiveNotifier {
    private static final String CHANNEL = "live";
    /** A tag of our own, so these can never collide with the numbered prayer reminders. */
    private static final String TAG = "live";
    private static final String LOG_TAG = "LiveNotifier";
    private static final int ACCENT = 0xFFE2CC9A;
    /** An odd number, far from what the widget's own intents use. */
    private static final int ID_BASE = 7100;

    private LiveNotifier() {}

    /** False when the user has turned off this app's notifications, or this channel. */
    static boolean allowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    /** Starts the item, or updates the one up under its id; nothing at all when the card would look the same. */
    static void show(Context context, LiveData.Item item) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !allowed(context)) return;
        synchronized (LiveStore.LOCK) {
            int shown = shownCount(context, item);
            String up = isUp(manager, item.id) ? LiveStore.upFingerprint(context, item.id) : null;
            switch (LiveData.plan(item, shown, System.currentTimeMillis(), up, LiveStore.dismissed(context, item.id))) {
                case POST:
                    post(context, manager, item, shown);
                    break;
                case KEEP:
                    LiveStore.saveItem(context, item);
                    break;
                case END:
                    end(context, item.id);
                    break;
                case SKIP:
                default:
                    break;
            }
        }
    }

    static void end(Context context, String id) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        synchronized (LiveStore.LOCK) {
            if (manager != null) manager.cancel(TAG, notificationId(id));
            LiveStore.forget(context, id);
        }
    }

    /** After a tap anywhere: the dhikr card moves on if it is up on this key, and goes at its number. Never brought back. */
    static void refreshCount(Context context, String key) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        synchronized (LiveStore.LOCK) {
            LiveData.Item item = LiveStore.item(context, LiveData.DHIKR);
            if (item != null && item.counts() && key.equals(item.key) && isUp(manager, LiveData.DHIKR)) show(context, item);
        }
    }

    /**
     * The widget's alarm at each prayer lands here, with the app closed: from the adhan to the iqama, a countdown that
     * takes itself off at the iqama. Anything else that redraws the widget lands here too, and changes nothing.
     */
    static void showIqamaIfDue(Context context, TodayWidget.Snapshot snapshot, long now) {
        if (snapshot == null || !snapshot.live) return;
        int due = LiveData.iqamaDue(snapshot.at, snapshot.iqama, now);
        if (due < 0) return;
        show(context, new LiveData.Item(LiveData.NEXT, snapshot.names[due], LiveData.IQAMA, snapshot.iqama[due], 0L, 0, 0, "",
                LiveData.FAITH_LINK));
    }

    private static int shownCount(Context context, LiveData.Item item) {
        return item.counts() ? LiveData.shownCount(item.count, LiveStore.pendingFor(context, item.key), item.of) : 0;
    }

    static boolean isUp(Context context, String id) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && isUp(manager, id);
    }

    private static boolean isUp(NotificationManager manager, String id) {
        int wanted = notificationId(id);
        for (StatusBarNotification posted : manager.getActiveNotifications()) {
            if (posted.getId() == wanted && TAG.equals(posted.getTag())) return true;
        }
        return false;
    }

    private static int notificationId(String id) {
        return ID_BASE + (LiveData.NEXT.equals(id) ? 1 : LiveData.DHIKR.equals(id) ? 2 : 3);
    }

    private static void post(Context context, NotificationManager manager, LiveData.Item item, int shown) {
        try {
            createChannel(context, manager);
            manager.notify(TAG, notificationId(item.id), build(context, item, shown));
            LiveStore.savePosted(context, item, LiveData.fingerprint(item, shown));
        } catch (RuntimeException e) {
            // This runs from the bridge, a tap and the widget's alarm. A card the system refuses must not take any of
            // those down; nothing is remembered, so the next show tries again.
            Log.w(LOG_TAG, "A live card could not be posted", e);
        }
    }

    /**
     * Silent on purpose: the reminder at the adhan already sounds. Default importance with no sound, not Low: Low counts
     * as a silent notification, which the lock screen can hide, and that is the one place this has to show.
     */
    private static void createChannel(Context context, NotificationManager manager) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, context.getString(R.string.live_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(context.getString(R.string.live_channel_description));
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    /** Standard or progress style, ongoing, titled, not colorized, no custom views, no group: what promotion asks for. */
    private static Notification build(Context context, LiveData.Item item, int shown) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_orb)
                .setColor(ACCENT)
                .setContentTitle(item.title)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setRequestPromotedOngoing(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(open(context, item))
                .setDeleteIntent(LiveReceiver.dismissed(context, item, notificationId(item.id)));
        addClock(builder, item);
        if (item.counts()) addCount(context, builder, item, shown);
        else builder.setContentText(item.detail);
        return builder.build();
    }

    /** System timers only: the card and the chip tick by themselves, with no updates from here. */
    private static void addClock(NotificationCompat.Builder builder, LiveData.Item item) {
        if (item.endsAt > 0) {
            builder.setWhen(item.endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
                    .setTimeoutAfter(Math.max(1L, item.endsAt - System.currentTimeMillis()));
        } else if (item.startedAt > 0) {
            builder.setWhen(item.startedAt).setShowWhen(true).setUsesChronometer(true);
        } else {
            builder.setShowWhen(false);
        }
    }

    private static void addCount(Context context, NotificationCompat.Builder builder, LiveData.Item item, int shown) {
        builder.setContentText(LiveData.countLine(shown, item.of))
                .setShortCriticalText(LiveData.chipText(shown, item.of))
                .addAction(new NotificationCompat.Action(R.drawable.ic_stat_orb, context.getString(R.string.live_add_one),
                        LiveReceiver.tap(context, item.key, notificationId(item.id))));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            builder.setStyle(new NotificationCompat.ProgressStyle()
                    .addProgressSegment(new NotificationCompat.ProgressStyle.Segment(item.of).setColor(ACCENT))
                    .setProgress(shown));
        } else {
            builder.setProgress(item.of, shown, false);
        }
    }

    private static PendingIntent open(Context context, LiveData.Item item) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(item.link), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, notificationId(item.id), intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
