package app.awqat;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.time.ZonedDateTime;

/**
 * The Quran on the home screen, 2 x 2: the page to read on, today's pages against the daily goal, and today's revision.
 * The same day lines as TodayWidget's, read the same way; it wakes itself at midnight, when they move on. Nothing here
 * comes from the prayer times, so it shows with a place only guessed too. A tap opens the mushaf at the bookmark, and the
 * revision line opens the revision.
 */
public class QuranWidget extends AppWidgetProvider {
    private static final String ACTION_REFRESH = "app.awqat.widget.QURAN_REFRESH";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refreshAll(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        refreshAll(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_REFRESH.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            refreshAll(context);
        }
    }

    @Override
    public void onDisabled(Context context) {
        WidgetIntents.cancel(context, refreshIntent(context));
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, QuranWidget.class));
        if (ids.length == 0) {
            WidgetIntents.cancel(context, refreshIntent(context));
            return;
        }
        TodayWidget.Snapshot snapshot = TodayWidget.read(context);
        ZonedDateTime now = ZonedDateTime.now(TodayWidget.zone(snapshot == null ? null : snapshot.tz));
        manager.updateAppWidget(ids, build(context, snapshot, now.toLocalDate().toString()));
        WidgetIntents.wakeAt(context, refreshIntent(context), TodayWidget.nextMidnight(now));
    }

    private static PendingIntent refreshIntent(Context context) {
        return WidgetIntents.refresh(context, QuranWidget.class, ACTION_REFRESH);
    }

    private static RemoteViews build(Context context, TodayWidget.Snapshot snapshot, String today) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quran);
        if (snapshot == null || snapshot.quran.length == 0) {
            // No snapshot yet: a quiet nudge to open the app, every line set as in the other state.
            views.setOnClickPendingIntent(R.id.quran_root, WidgetIntents.open(context, "home", 22));
            views.setTextViewText(R.id.quran_page, context.getString(R.string.widget_open_app));
            views.setTextViewText(R.id.quran_read, context.getString(R.string.widget_open_hint));
            views.setViewVisibility(R.id.quran_read, View.VISIBLE);
            views.setViewVisibility(R.id.quran_revise, View.GONE);
            return views;
        }
        views.setOnClickPendingIntent(R.id.quran_root, WidgetIntents.open(context, "mushaf", 20));
        views.setOnClickPendingIntent(R.id.quran_revise, WidgetIntents.open(context, "revise", 21));
        // Today's lines, or the last day's once the app has stayed closed past it (TodayWidgetData.dayIndex).
        int day = TodayWidgetData.dayIndex(snapshot.dates, today);
        String page = day >= 0 ? snapshot.quran[day] : snapshot.quran[0];
        String read = day >= 0 ? snapshot.read[day] : "";
        String revise = day >= 0 ? snapshot.revise[day] : "";
        views.setTextViewText(R.id.quran_page, page);
        views.setTextViewText(R.id.quran_read, read);
        views.setViewVisibility(R.id.quran_read, read.isEmpty() ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.quran_revise, revise);
        views.setViewVisibility(R.id.quran_revise, revise.isEmpty() ? View.GONE : View.VISIBLE);
        return views;
    }
}
