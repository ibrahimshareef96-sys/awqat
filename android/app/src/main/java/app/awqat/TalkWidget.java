package app.awqat;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/**
 * Talk on the home screen, 1 x 1: one tap opens the app on the Talk sheet, through the same checked link as every
 * widget. Nothing here changes with time or the snapshot, so it is drawn once and the system's periodic update is off.
 */
public class TalkWidget extends AppWidgetProvider {
    private static final int ACCENT = 0xFFE2CC9A;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_talk);
        views.setInt(R.id.talk_icon, "setColorFilter", ACCENT);
        views.setOnClickPendingIntent(R.id.talk_root, WidgetIntents.open(context, "talk", 50));
        manager.updateAppWidget(ids, views);
    }
}
