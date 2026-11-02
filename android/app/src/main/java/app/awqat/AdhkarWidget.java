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
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The morning and evening adhkar on the home screen, 2 x 1: each said, open now, or later. From the snapshot's windows
 * alone, waking itself as a set opens or closes. A tap opens the adhkar (the app picks the set open now). Names of the
 * sets only, never their words.
 */
public class AdhkarWidget extends AppWidgetProvider {
    private static final String ACTION_REFRESH = "app.awqat.widget.ADHKAR_REFRESH";
    private static final int DAYS_MAX = 14;
    private static final int OPEN_COLOR = 0xFFE2CC9A;
    private static final int SAID_COLOR = 0xFFECE6D8;
    private static final int LATER_COLOR = 0xADECE6D8;

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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AdhkarWidget.class));
        if (ids.length == 0) {
            WidgetIntents.cancel(context, refreshIntent(context));
            return;
        }
        JSONObject root = SnapshotJson.read(context);
        AdhkarData.Day[] days = days(root);
        long now = System.currentTimeMillis();
        manager.updateAppWidget(ids, build(context, root, days, now));
        long change = AdhkarData.nextChange(days, now);
        if (change > 0) WidgetIntents.wakeAt(context, refreshIntent(context), change);
        else WidgetIntents.cancel(context, refreshIntent(context));
    }

    private static PendingIntent refreshIntent(Context context) {
        return WidgetIntents.refresh(context, AdhkarWidget.class, ACTION_REFRESH);
    }

    static AdhkarData.Day[] days(JSONObject root) {
        JSONArray list = root == null ? null : root.optJSONArray("adhkar");
        if (list == null) return new AdhkarData.Day[0];
        List<AdhkarData.Day> days = new ArrayList<>();
        try {
            for (int i = 0; i < Math.min(list.length(), DAYS_MAX); i++) {
                JSONObject day = list.getJSONObject(i);
                JSONObject morning = day.getJSONObject("morning");
                JSONObject evening = day.getJSONObject("evening");
                days.add(new AdhkarData.Day(morning.getLong("from"), morning.getLong("to"), morning.optBoolean("said"),
                        evening.getLong("from"), evening.getLong("to"), evening.optBoolean("said")));
            }
        } catch (JSONException e) {
            return new AdhkarData.Day[0];
        }
        return days.toArray(new AdhkarData.Day[0]);
    }

    private static RemoteViews build(Context context, JSONObject root, AdhkarData.Day[] days, long now) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_adhkar);
        int day = AdhkarData.dayIndex(days, now);
        // A guessed place's windows are Makkah's: none is shown. No snapshot yet, or it ran out: a quiet nudge.
        if (SnapshotJson.placeUnset(root)) return message(context, views, R.string.widget_set_place);
        if (day < 0 || AdhkarData.nextChange(days, now) < 0) return message(context, views, R.string.widget_open_hint);
        AdhkarData.Day today = days[day];
        views.setOnClickPendingIntent(R.id.adhkar_root, WidgetIntents.open(context, "adhkar", 30));
        views.setViewVisibility(R.id.adhkar_message, View.GONE);
        views.setViewVisibility(R.id.adhkar_sets, View.VISIBLE);
        int morning = AdhkarData.state(today.morningFrom, today.morningTo, today.morningSaid, now);
        int evening = AdhkarData.state(today.eveningFrom, today.eveningTo, today.eveningSaid, now);
        setState(context, views, R.id.adhkar_morning, R.id.adhkar_morning_state, R.string.adhkar_morning, morning);
        setState(context, views, R.id.adhkar_evening, R.id.adhkar_evening_state, R.string.adhkar_evening, evening);
        return views;
    }

    private static void setState(Context context, RemoteViews views, int set, int line, int name, int state) {
        String word = context.getString(state == AdhkarData.SAID ? R.string.adhkar_said
                : state == AdhkarData.OPEN ? R.string.adhkar_open : R.string.adhkar_later);
        views.setTextViewText(line, word);
        views.setTextColor(line, state == AdhkarData.OPEN ? OPEN_COLOR : state == AdhkarData.SAID ? SAID_COLOR : LATER_COLOR);
        views.setContentDescription(set, context.getString(name) + ", " + word);
    }

    /** One line instead of the two sets; a tap opens Home, where the place is set and the app first fills this in. */
    private static RemoteViews message(Context context, RemoteViews views, int text) {
        views.setOnClickPendingIntent(R.id.adhkar_root, WidgetIntents.open(context, "home", 31));
        views.setTextViewText(R.id.adhkar_message, context.getString(text));
        views.setViewVisibility(R.id.adhkar_message, View.VISIBLE);
        views.setViewVisibility(R.id.adhkar_sets, View.GONE);
        return views;
    }
}
