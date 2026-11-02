package app.awqat;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

/**
 * What every widget, the shortcuts and the Quick Settings tile share: the one kind of link they open the app with
 * (awqat://go/<screen>, followed by the app only for the screens they send), and the alarm a widget wakes itself with.
 */
final class WidgetIntents {
    private WidgetIntents() {}

    /** The app on a screen, through the same checked link a widget tap sends. */
    static Intent link(Context context, String screen) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("awqat://go/" + screen), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    /** A tap that opens the app on a screen; each widget part keeps its own request code. */
    static PendingIntent open(Context context, String screen, int requestCode) {
        return PendingIntent.getActivity(context, requestCode, link(context, screen),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A widget's own broadcast back to itself, to redraw. Explicit, so nothing else can send or catch it. */
    static PendingIntent refresh(Context context, Class<?> provider, String action) {
        Intent intent = new Intent(context, provider).setAction(action);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * Wakes a widget just after its next change. Not a wake-up alarm: if the phone sleeps through it, the widget moves
     * on as soon as the screen comes back, which is the only time it is seen.
     */
    static void wakeAt(Context context, PendingIntent intent, long when) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        long at = when + 1_000L;
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
                alarms.setExact(AlarmManager.RTC, at, intent);
            } else {
                alarms.set(AlarmManager.RTC, at, intent);
            }
        } catch (SecurityException e) {
            alarms.set(AlarmManager.RTC, at, intent);
        }
    }

    static void cancel(Context context, PendingIntent intent) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(intent);
    }
}
