package app.awqat;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The prayer day on the home screen, 4 x 2: the Hijri date, the day's five prayers with the one under way marked, the
 * next one counting down, and the iqama to come. It runs from the snapshot alone, waking itself at each prayer, at the
 * end of each prayer's time and at each iqama; each wake is also when the iqama card goes up (LiveNotifier), as with
 * TodayWidget. A tap opens Faith.
 */
public class PrayerDayWidget extends AppWidgetProvider {
    private static final String ACTION_REFRESH = "app.awqat.widget.PRAYER_DAY_REFRESH";
    private static final int DAYS_MAX = 14;
    private static final int NAME_MAX = 16;
    private static final int TIME_MAX = 8;
    private static final int HIJRI_MAX = 40;
    private static final int[] COLUMNS = {R.id.prayer_day_col0, R.id.prayer_day_col1, R.id.prayer_day_col2,
        R.id.prayer_day_col3, R.id.prayer_day_col4};
    private static final int[] NAMES = {R.id.prayer_day_name0, R.id.prayer_day_name1, R.id.prayer_day_name2,
        R.id.prayer_day_name3, R.id.prayer_day_name4};
    private static final int[] TIMES = {R.id.prayer_day_time0, R.id.prayer_day_time1, R.id.prayer_day_time2,
        R.id.prayer_day_time3, R.id.prayer_day_time4};
    /** The one under way, in the one accent; the rest as the app sets its lists. */
    private static final int CURRENT_COLOR = 0xFFE2CC9A;
    private static final int NAME_COLOR = 0xADECE6D8;
    private static final int TIME_COLOR = 0xFFECE6D8;

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

    /** Draws every placed widget from the snapshot and sets the alarm for its next change. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PrayerDayWidget.class));
        if (ids.length == 0) {
            WidgetIntents.cancel(context, refreshIntent(context));
            return;
        }
        JSONObject root = SnapshotJson.read(context);
        PrayerDayData.Day[] days = days(root);
        long now = System.currentTimeMillis();
        manager.updateAppWidget(ids, build(context, root, days, now));
        long change = PrayerDayData.nextChange(days, now);
        if (change > 0) WidgetIntents.wakeAt(context, refreshIntent(context), change);
        else WidgetIntents.cancel(context, refreshIntent(context));
        LiveNotifier.showIqamaIfDue(context, TodayWidget.read(context), now);
    }

    private static PendingIntent refreshIntent(Context context) {
        return WidgetIntents.refresh(context, PrayerDayWidget.class, ACTION_REFRESH);
    }

    /** The prayer days in the snapshot, capped and cut to fit; none when there are none or they do not read. */
    static PrayerDayData.Day[] days(JSONObject root) {
        JSONArray list = root == null ? null : root.optJSONArray("prayerDays");
        if (list == null) return new PrayerDayData.Day[0];
        List<PrayerDayData.Day> days = new ArrayList<>();
        try {
            for (int i = 0; i < Math.min(list.length(), DAYS_MAX); i++) {
                days.add(day(list.getJSONObject(i)));
            }
        } catch (JSONException e) {
            return new PrayerDayData.Day[0];
        }
        return days.toArray(new PrayerDayData.Day[0]);
    }

    private static PrayerDayData.Day day(JSONObject raw) throws JSONException {
        JSONArray prayers = raw.getJSONArray("prayers");
        int count = Math.min(prayers.length(), COLUMNS.length);
        String[] names = new String[count];
        String[] times = new String[count];
        long[] at = new long[count];
        long[] until = new long[count];
        long[] iqama = new long[count];
        String[] iqamaTimes = new String[count];
        for (int i = 0; i < count; i++) {
            JSONObject p = prayers.getJSONObject(i);
            names[i] = TodayWidgetData.clip(p.optString("name"), NAME_MAX);
            times[i] = TodayWidgetData.clip(p.optString("time"), TIME_MAX);
            at[i] = p.getLong("at");
            until[i] = Math.max(0L, p.optLong("until"));
            iqama[i] = Math.max(0L, p.optLong("iqama"));
            iqamaTimes[i] = TodayWidgetData.clip(p.optString("iqamaTime"), TIME_MAX);
        }
        JSONObject hijri = raw.optJSONObject("hijri");
        String text = hijri == null ? "" : TodayWidgetData.clip(hijri.optString("text"), HIJRI_MAX);
        return new PrayerDayData.Day(text, names, times, at, until, iqama, iqamaTimes);
    }

    private static RemoteViews build(Context context, JSONObject root, PrayerDayData.Day[] days, long now) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_prayer_day);
        int day = PrayerDayData.dayIndex(days, now);
        PrayerDayData.Pick next = PrayerDayData.next(days, now);
        // A guessed place's times are Makkah's: none of them is shown. No snapshot yet, or it ran out: a quiet nudge.
        if (SnapshotJson.placeUnset(root)) return message(context, views, R.string.widget_set_place);
        if (day < 0 || next == null) return message(context, views, R.string.widget_open_hint);
        views.setOnClickPendingIntent(R.id.prayer_day_root, WidgetIntents.open(context, "faith", 10));
        PrayerDayData.Day today = days[day];
        views.setTextViewText(R.id.prayer_day_hijri,
                today.hijri.isEmpty() ? context.getString(R.string.prayer_day_label) : today.hijri);
        views.setViewVisibility(R.id.prayer_day_message, View.GONE);
        views.setViewVisibility(R.id.prayer_day_grid, View.VISIBLE);
        views.setViewVisibility(R.id.prayer_day_bottom, View.VISIBLE);
        int current = PrayerDayData.current(today, now);
        fillPrayers(context, views, today, current);
        setCountdown(context, views, days[next.day], next.prayer, now);
        views.setTextViewText(R.id.prayer_day_iqama, iqamaLine(context, days, PrayerDayData.iqama(days, day, current, next, now)));
        return views;
    }

    /** Every column is set in every state: a launcher reapplies an update onto the views it already has. */
    private static void fillPrayers(Context context, RemoteViews views, PrayerDayData.Day today, int current) {
        for (int i = 0; i < COLUMNS.length; i++) {
            boolean shown = i < today.at.length;
            views.setViewVisibility(COLUMNS[i], shown ? View.VISIBLE : View.GONE);
            if (!shown) continue;
            boolean marked = i == current;
            views.setTextViewText(NAMES[i], today.names[i]);
            views.setTextViewText(TIMES[i], today.times[i]);
            views.setTextColor(NAMES[i], marked ? CURRENT_COLOR : NAME_COLOR);
            views.setTextColor(TIMES[i], marked ? CURRENT_COLOR : TIME_COLOR);
            String spoken = today.names[i] + " " + today.times[i];
            views.setContentDescription(COLUMNS[i], marked ? context.getString(R.string.prayer_day_now, spoken) : spoken);
        }
    }

    /** "Asr in 1:23:45", by a system timer in the launcher that ticks with no updates from here. */
    private static void setCountdown(Context context, RemoteViews views, PrayerDayData.Day day, int prayer, long now) {
        long base = TodayWidgetData.chronometerBase(day.at[prayer], now, SystemClock.elapsedRealtime());
        String format = PrayerDayData.countdownFormat(day.names[prayer], context.getString(R.string.prayer_day_in));
        views.setChronometer(R.id.prayer_day_countdown, base, format, true);
        views.setChronometerCountDown(R.id.prayer_day_countdown, true);
    }

    private static String iqamaLine(Context context, PrayerDayData.Day[] days, PrayerDayData.Pick pick) {
        if (pick == null || days[pick.day].iqamaTimes[pick.prayer].isEmpty()) return "";
        return context.getString(R.string.prayer_day_iqama, days[pick.day].names[pick.prayer],
                days[pick.day].iqamaTimes[pick.prayer]);
    }

    /** One line instead of the day ("Set your place", or open the app once); a tap opens Home, where both are done. */
    private static RemoteViews message(Context context, RemoteViews views, int text) {
        views.setOnClickPendingIntent(R.id.prayer_day_root, WidgetIntents.open(context, "home", 11));
        views.setTextViewText(R.id.prayer_day_hijri, context.getString(R.string.widget_today_label));
        views.setTextViewText(R.id.prayer_day_message, context.getString(text));
        views.setViewVisibility(R.id.prayer_day_message, View.VISIBLE);
        views.setViewVisibility(R.id.prayer_day_grid, View.GONE);
        views.setViewVisibility(R.id.prayer_day_bottom, View.GONE);
        return views;
    }
}
