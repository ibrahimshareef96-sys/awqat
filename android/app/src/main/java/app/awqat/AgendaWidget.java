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
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The next meeting on the home screen, 4 x 2: today's or tomorrow's, when it is, and the prayer before and after it.
 * With no calendar it says so, and a tap opens Agenda to add one. Home screen only (widget_agenda_info.xml): a
 * meeting's title is private, so it never goes on the lock screen. It wakes itself as a meeting begins or ends, and
 * at midnight, when today and tomorrow move on.
 */
public class AgendaWidget extends AppWidgetProvider {
    private static final String ACTION_REFRESH = "app.awqat.widget.AGENDA_REFRESH";
    private static final int MEETINGS_MAX = 12;
    private static final int TITLE_MAX = 60;
    private static final int LINE_MAX = 24;

    /** The meetings in the snapshot, sorted by the app; empty when there are none or they do not read. */
    static final class Meetings {
        final boolean known;
        final boolean calendar;
        final String[] titles;
        final String[] dates;
        final String[] times;
        final String[] before;
        final String[] after;
        final long[] start;
        final long[] end;

        Meetings(boolean known, boolean calendar, int count) {
            this.known = known;
            this.calendar = calendar;
            titles = new String[count];
            dates = new String[count];
            times = new String[count];
            before = new String[count];
            after = new String[count];
            start = new long[count];
            end = new long[count];
        }
    }

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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AgendaWidget.class));
        if (ids.length == 0) {
            WidgetIntents.cancel(context, refreshIntent(context));
            return;
        }
        JSONObject root = SnapshotJson.read(context);
        Meetings meetings = meetings(root);
        ZonedDateTime now = SnapshotJson.now(root);
        manager.updateAppWidget(ids, build(context, root, meetings, now));
        long nowMs = now.toInstant().toEpochMilli();
        long change = AgendaData.nextChange(meetings.start, meetings.end, nowMs, TodayWidget.nextMidnight(now));
        if (change > 0) WidgetIntents.wakeAt(context, refreshIntent(context), change);
    }

    private static PendingIntent refreshIntent(Context context) {
        return WidgetIntents.refresh(context, AgendaWidget.class, ACTION_REFRESH);
    }

    /** `known` is false for no snapshot, or one from an app older than this widget. */
    static Meetings meetings(JSONObject root) {
        if (root == null || !root.has("calendar")) return new Meetings(false, false, 0);
        boolean calendar = root.optBoolean("calendar");
        JSONArray list = root.optJSONArray("meetings");
        int count = list == null ? 0 : Math.min(list.length(), MEETINGS_MAX);
        Meetings meetings = new Meetings(true, calendar, count);
        try {
            for (int i = 0; i < count; i++) {
                JSONObject m = list.getJSONObject(i);
                meetings.titles[i] = TodayWidgetData.clip(m.optString("title"), TITLE_MAX);
                meetings.dates[i] = m.optString("date");
                meetings.times[i] = TodayWidgetData.clip(m.optString("time"), 8);
                meetings.before[i] = TodayWidgetData.clip(m.optString("before"), LINE_MAX);
                meetings.after[i] = TodayWidgetData.clip(m.optString("after"), LINE_MAX);
                meetings.start[i] = m.getLong("start");
                meetings.end[i] = m.getLong("end");
            }
        } catch (JSONException e) {
            return new Meetings(true, calendar, 0);
        }
        return meetings;
    }

    private static RemoteViews build(Context context, JSONObject root, Meetings meetings, ZonedDateTime now) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_agenda);
        long nowMs = now.toInstant().toEpochMilli();
        int next = AgendaData.next(meetings.start, meetings.end, nowMs);
        if (!meetings.known) return message(context, views, R.string.widget_open_hint, "home", 41);
        if (!meetings.calendar) return message(context, views, R.string.agenda_connect, "agenda", 40);
        if (next < 0) return message(context, views, R.string.agenda_none, "agenda", 40);
        views.setOnClickPendingIntent(R.id.agenda_root, WidgetIntents.open(context, "agenda", 40));
        String today = now.toLocalDate().toString();
        String tomorrow = now.toLocalDate().plusDays(1).toString();
        int when = AgendaData.when(meetings.dates[next], today, tomorrow, meetings.start[next], meetings.end[next], nowMs);
        views.setTextViewText(R.id.agenda_when, whenLine(context, when, meetings.times[next]));
        views.setViewVisibility(R.id.agenda_when, View.VISIBLE);
        views.setTextViewText(R.id.agenda_title, meetings.titles[next]);
        views.setViewVisibility(R.id.agenda_rule, View.VISIBLE);
        fillPrayers(views, SnapshotJson.placeUnset(root), meetings.before[next], meetings.after[next]);
        return views;
    }

    private static String whenLine(Context context, int when, String time) {
        if (when == AgendaData.NOW) return context.getString(R.string.agenda_now);
        if (when == AgendaData.TODAY) return context.getString(R.string.agenda_today, time);
        if (when == AgendaData.TOMORROW) return context.getString(R.string.agenda_tomorrow, time);
        return time;
    }

    /** The prayers around it, or "Set your place" while the place is only guessed (the app then sends none). */
    private static void fillPrayers(RemoteViews views, boolean placeUnset, String before, String after) {
        boolean prayers = !placeUnset && !(before.isEmpty() && after.isEmpty());
        views.setViewVisibility(R.id.agenda_prayers, prayers ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.agenda_note, placeUnset ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.agenda_before, before);
        views.setTextViewText(R.id.agenda_after, after);
    }

    /** One line in place of a meeting: no snapshot yet, no calendar, or nothing today or tomorrow. */
    private static RemoteViews message(Context context, RemoteViews views, int text, String screen, int requestCode) {
        views.setOnClickPendingIntent(R.id.agenda_root, WidgetIntents.open(context, screen, requestCode));
        views.setTextViewText(R.id.agenda_title, context.getString(text));
        views.setViewVisibility(R.id.agenda_when, View.GONE);
        views.setViewVisibility(R.id.agenda_rule, View.GONE);
        views.setViewVisibility(R.id.agenda_prayers, View.GONE);
        views.setViewVisibility(R.id.agenda_note, View.GONE);
        return views;
    }
}
