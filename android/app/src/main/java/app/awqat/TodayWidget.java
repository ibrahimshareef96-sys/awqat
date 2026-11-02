package app.awqat;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.TypedValue;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The home-screen widget: the next prayer and a countdown to it, the page to read on, today's revision, and the steps
 * when there is room. It runs with the app closed from the snapshot the app last gave it (about 12 days of prayer times),
 * and wakes itself at the next prayer and at midnight to move on. Made smaller, it shows the next prayer with its label,
 * then the next prayer only. Each wake is also when the iqama countdown goes up (LiveNotifier). After a reboot the system
 * sends the update broadcast again, which sets the countdown's base and the alarm afresh.
 */
public class TodayWidget extends AppWidgetProvider {
    static final String PREFS = "awqat_widget";
    static final String KEY = "snapshot";
    private static final String ACTION_REFRESH = "app.awqat.widget.REFRESH";
    private static final int PRAYERS_MAX = 60;
    private static final int DAYS_MAX = 4;
    private static final int LINE_MAX = 40;
    /** Heights (dp) from which each layout fits with room for a larger font: one row, the label too, every line. */
    private static final float SMALL_DP = 40f;
    private static final float MEDIUM_DP = 80f;
    private static final float FULL_DP = 130f;
    /** The steps line adds about 19dp to the full layout: only from here does a larger font still fit. */
    private static final float STEPS_DP = 150f;
    /** The narrowest the widget can be made (3 cells). */
    private static final float WIDTH_DP = 180f;
    /** From here one row holds "Maghrib  18:02" and "1:23:45" whole (about 191dp and the padding). */
    private static final float ROW_WIDE_DP = 230f;
    private static final Pattern DAY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final float PRAYER_SP = 20f;
    private static final float NUDGE_SP = 18f;
    /** The time's colour beside the prayer's name: the ivory at 70%. */
    private static final int TIME_COLOR = 0xB3ECE6D8;

    /** What the app last handed over, read back defensively. An `iqama` of 0 means that prayer has none. */
    static final class Snapshot {
        final String tz;
        final String[] names;
        final String[] times;
        final long[] at;
        final long[] iqama;
        final String[] dates;
        final String[] quran;
        final String[] revise;
        final String steps;
        final boolean live;

        Snapshot(String tz, String[] names, String[] times, long[] at, long[] iqama, String[] dates, String[] quran,
                String[] revise, String steps, boolean live) {
            this.tz = tz;
            this.names = names;
            this.times = times;
            this.at = at;
            this.iqama = iqama;
            this.dates = dates;
            this.quran = quran;
            this.revise = revise;
            this.steps = steps;
            this.live = live;
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
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(refreshIntent(context));
    }

    /** Keeps a snapshot from the app (already checked by the bridge). */
    static void save(Context context, String snapshot) {
        prefs(context).edit().putString(KEY, snapshot).apply();
    }

    /** Draws every placed widget from the snapshot and sets the alarm for the next change. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        if (ids.length == 0) {
            onNoWidgets(context);
            return;
        }
        Snapshot snapshot = read(context);
        ZoneId zone = zoneOf(snapshot);
        ZonedDateTime now = ZonedDateTime.now(zone);
        for (int id : ids) {
            manager.updateAppWidget(id, viewsFor(context, snapshot, now, manager.getAppWidgetOptions(id)));
        }
        long midnight = now.toLocalDate().plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
        long[] at = snapshot == null ? new long[0] : snapshot.at;
        long nowMs = now.toInstant().toEpochMilli();
        scheduleRefresh(context, TodayWidgetData.nextChange(at, nowMs, midnight));
        LiveNotifier.showIqamaIfDue(context, snapshot, nowMs);
    }

    private static void onNoWidgets(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(refreshIntent(context));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static ZoneId zoneOf(Snapshot snapshot) {
        if (snapshot != null) {
            try {
                return ZoneId.of(snapshot.tz);
            } catch (DateTimeException e) {
                // A zone this phone does not know: its own zone instead.
            }
        }
        return ZoneId.systemDefault();
    }

    /** The snapshot, or null when there is none yet or it cannot be read. Lists are capped and lines cut to fit. */
    static Snapshot read(Context context) {
        String json = prefs(context).getString(KEY, null);
        if (json == null) return null;
        try {
            JSONObject root = new JSONObject(json);
            if (root.optInt("v") != 1) return null;
            JSONArray prayers = root.getJSONArray("prayers");
            int count = Math.min(prayers.length(), PRAYERS_MAX);
            String[] names = new String[count];
            String[] times = new String[count];
            long[] at = new long[count];
            long[] iqama = new long[count];
            for (int i = 0; i < count; i++) {
                JSONObject p = prayers.getJSONObject(i);
                names[i] = TodayWidgetData.clip(p.optString("name"), LINE_MAX);
                times[i] = TodayWidgetData.clip(p.optString("time"), 8);
                at[i] = p.getLong("at");
                iqama[i] = p.optLong("iqama");
            }
            JSONArray days = root.getJSONArray("days");
            int dayCount = Math.min(days.length(), DAYS_MAX);
            String[] dates = new String[dayCount];
            String[] quran = new String[dayCount];
            String[] revise = new String[dayCount];
            for (int i = 0; i < dayCount; i++) {
                JSONObject d = days.getJSONObject(i);
                String date = d.optString("date");
                // Dates are compared as text, so only YYYY-MM-DD is kept.
                dates[i] = DAY.matcher(date).matches() ? date : "";
                quran[i] = TodayWidgetData.clip(d.optString("quran"), LINE_MAX);
                revise[i] = TodayWidgetData.clip(d.optString("revise"), LINE_MAX);
            }
            return new Snapshot(root.optString("tz", ""), names, times, at, iqama, dates, quran, revise,
                    TodayWidgetData.clip(root.optString("steps"), LINE_MAX), root.optBoolean("live", true));
        } catch (JSONException e) {
            return null;
        }
    }

    private static RemoteViews viewsFor(Context context, Snapshot snapshot, ZonedDateTime now, Bundle options) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Every height at both widths: the launcher takes the nearest size, and a wide row alone would beat a tall one.
            // A separate RemoteViews each: the map's constructor stamps each one with its own size.
            Map<SizeF, RemoteViews> sizes = new HashMap<>();
            for (float width : new float[] {WIDTH_DP, ROW_WIDE_DP}) {
                sizes.put(new SizeF(width, SMALL_DP), row(context, snapshot, now, width >= ROW_WIDE_DP));
                sizes.put(new SizeF(width, MEDIUM_DP), build(context, R.layout.widget_today_medium, snapshot, now, false));
                sizes.put(new SizeF(width, FULL_DP), build(context, R.layout.widget_today, snapshot, now, false));
                sizes.put(new SizeF(width, STEPS_DP), build(context, R.layout.widget_today, snapshot, now, true));
            }
            return new RemoteViews(sizes);
        }
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        if (height <= 0) return build(context, R.layout.widget_today, snapshot, now, false);
        if (height < MEDIUM_DP) return row(context, snapshot, now, width >= ROW_WIDE_DP);
        if (height < FULL_DP) return build(context, R.layout.widget_today_medium, snapshot, now, false);
        return build(context, R.layout.widget_today, snapshot, now, height >= STEPS_DP);
    }

    /** One row high. The prayer and its time come first; the countdown joins them only where all three fit whole. */
    private static RemoteViews row(Context context, Snapshot snapshot, ZonedDateTime now, boolean countdown) {
        RemoteViews views = build(context, R.layout.widget_today_small, snapshot, now, false);
        if (!countdown) views.setViewVisibility(R.id.widget_countdown, View.GONE);
        return views;
    }

    private static RemoteViews build(Context context, int layout, Snapshot snapshot, ZonedDateTime now, boolean steps) {
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        boolean label = layout != R.layout.widget_today_small;
        boolean lines = layout == R.layout.widget_today;
        views.setOnClickPendingIntent(R.id.widget_root, open(context, "home", 1));
        views.setOnClickPendingIntent(R.id.widget_prayer, open(context, "faith", 2));
        int next = snapshot == null ? -1 : TodayWidgetData.nextPrayer(snapshot.at, now.toInstant().toEpochMilli());
        if (next < 0) {
            // No snapshot yet, or it ran out: a quiet nudge to open the app, small enough to fit the narrowest widget.
            if (label) views.setTextViewText(R.id.widget_label, context.getString(R.string.widget_today_label));
            views.setTextViewText(R.id.widget_name, context.getString(R.string.widget_open_app));
            views.setTextViewTextSize(R.id.widget_name, TypedValue.COMPLEX_UNIT_SP, NUDGE_SP);
            views.setViewVisibility(R.id.widget_countdown, View.GONE);
            if (lines) {
                views.setTextViewText(R.id.widget_quran, context.getString(R.string.widget_open_hint));
                views.setViewVisibility(R.id.widget_revise, View.GONE);
                views.setViewVisibility(R.id.widget_steps, View.GONE);
            }
            return views;
        }
        if (label) views.setTextViewText(R.id.widget_label, context.getString(R.string.widget_next_prayer));
        // Set every time: a launcher reapplies a new update onto the views it has, so the nudge's size would stay.
        views.setTextViewTextSize(R.id.widget_name, TypedValue.COMPLEX_UNIT_SP, PRAYER_SP);
        views.setTextViewText(R.id.widget_name, prayerLine(snapshot.names[next], snapshot.times[next]));
        setCountdown(views, snapshot.at[next], now.toInstant().toEpochMilli());
        if (lines) {
            fillDay(context, views, snapshot, now.toLocalDate().toString());
            fillSteps(context, views, steps ? snapshot.steps : "");
        }
        return views;
    }

    /** A system timer in the launcher: it ticks with no updates from here, and stops at the alarm that moves the widget on. */
    private static void setCountdown(RemoteViews views, long at, long now) {
        long base = TodayWidgetData.chronometerBase(at, now, SystemClock.elapsedRealtime());
        views.setChronometer(R.id.widget_countdown, base, null, true);
        views.setChronometerCountDown(R.id.widget_countdown, true);
        views.setViewVisibility(R.id.widget_countdown, View.VISIBLE);
    }

    private static void fillSteps(Context context, RemoteViews views, String steps) {
        views.setTextViewText(R.id.widget_steps, steps);
        views.setViewVisibility(R.id.widget_steps, steps.isEmpty() ? View.GONE : View.VISIBLE);
        views.setOnClickPendingIntent(R.id.widget_steps, open(context, "body", 6));
    }

    /**
     * The prayer and its time on one line, the time softer. The line is cut from its start when it runs out of room
     * (layout: ellipsize="start"), so the time always shows: "Maghrib 18:02" fits the narrowest widget at normal size.
     */
    private static CharSequence prayerLine(String name, String time) {
        SpannableString line = new SpannableString(name + "  " + time);
        line.setSpan(new ForegroundColorSpan(TIME_COLOR), name.length() + 2, line.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return line;
    }

    /**
     * Today's lines: the page to read on always (it does not change at midnight), and the revision for today, or for the
     * last day in the snapshot once the app has stayed closed past it.
     */
    private static void fillDay(Context context, RemoteViews views, Snapshot snapshot, String today) {
        int day = TodayWidgetData.dayIndex(snapshot.dates, today);
        String quran = day >= 0 ? snapshot.quran[day] : (snapshot.quran.length > 0 ? snapshot.quran[0] : "");
        String revise = day >= 0 ? snapshot.revise[day] : "";
        views.setTextViewText(R.id.widget_quran, quran);
        views.setOnClickPendingIntent(R.id.widget_quran, open(context, "mushaf", 3));
        views.setTextViewText(R.id.widget_revise, revise);
        views.setViewVisibility(R.id.widget_revise, revise.isEmpty() ? View.GONE : View.VISIBLE);
        views.setOnClickPendingIntent(R.id.widget_revise, open(context, "revise", 4));
    }

    /** Opens the app on a screen; the app follows only the screens the widget sends. */
    private static PendingIntent open(Context context, String screen, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("awqat://go/" + screen), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent refreshIntent(Context context) {
        Intent intent = new Intent(context, TodayWidget.class).setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * Wakes the widget just after its next change. Not a wake-up alarm: if the phone sleeps through it, the widget moves
     * on as soon as the screen comes back, which is the only time it is seen.
     */
    private static void scheduleRefresh(Context context, long when) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        PendingIntent intent = refreshIntent(context);
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
}
