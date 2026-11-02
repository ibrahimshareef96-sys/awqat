package app.awqat;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The dhikr counter on the home screen: the name and the count from the app's snapshot, and the whole widget is the
 * button. A tap adds to the pending taps and redraws at once, without opening the app, which takes them when it next
 * comes to the front. Names only, never du'a text.
 */
public class DhikrWidget extends AppWidgetProvider {
    private static final String ACTION_TAP = "app.awqat.widget.DHIKR_TAP";
    private static final String EXTRA_KEY = "key";
    private static final String MODES_LINK = "awqat://go/modes";
    private static final int NAME_MAX = 60;
    private static final float COUNT_SP = 28f;
    private static final float NOTHING_SP = 15f;

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
        if (ACTION_TAP.equals(intent.getAction())) onTap(context, intent.getStringExtra(EXTRA_KEY));
    }

    /** A tap on what the widget shows now; at the number it does nothing. A tap on an older key only redraws. */
    private static void onTap(Context context, String key) {
        LiveData.Item dhikr = read(context);
        if (dhikr != null && dhikr.key.equals(key)) {
            synchronized (LiveStore.LOCK) {
                int shown = LiveData.shownCount(dhikr.count, LiveStore.pendingFor(context, key), dhikr.of);
                if (LiveData.canTap(shown, dhikr.of)) LiveStore.addTap(context, key);
                LiveNotifier.refreshCount(context, key);
            }
        }
        refreshAll(context);
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, DhikrWidget.class));
        if (ids.length == 0) return;
        manager.updateAppWidget(ids, build(context, read(context)));
    }

    /** The open dhikr in the snapshot, or null when there is none or it cannot be counted. */
    private static LiveData.Item read(Context context) {
        String json = context.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE).getString(TodayWidget.KEY, null);
        if (json == null) return null;
        try {
            JSONObject raw = new JSONObject(json).optJSONObject("dhikr");
            if (raw == null) return null;
            LiveData.Item item = new LiveData.Item(LiveData.DHIKR, TodayWidgetData.clip(raw.optString("name"), NAME_MAX), "", 0L, 0L,
                    Math.max(0, raw.optInt("n")), raw.optInt("of"), raw.optString("key"), MODES_LINK);
            return item.isValid() && item.counts() ? item : null;
        } catch (JSONException e) {
            return null;
        }
    }

    private static RemoteViews build(Context context, LiveData.Item dhikr) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_dhikr);
        if (dhikr == null) {
            views.setViewVisibility(R.id.dhikr_name, View.GONE);
            views.setViewVisibility(R.id.dhikr_add, View.GONE);
            views.setTextViewTextSize(R.id.dhikr_count, TypedValue.COMPLEX_UNIT_SP, NOTHING_SP);
            views.setTextViewText(R.id.dhikr_count, context.getString(R.string.dhikr_nothing));
            views.setContentDescription(R.id.dhikr_root, context.getString(R.string.dhikr_nothing));
            views.setOnClickPendingIntent(R.id.dhikr_root, openModes(context));
            return views;
        }
        int shown = LiveData.shownCount(dhikr.count, LiveStore.pendingFor(context, dhikr.key), dhikr.of);
        String line = LiveData.countLine(shown, dhikr.of);
        views.setViewVisibility(R.id.dhikr_name, View.VISIBLE);
        views.setTextViewText(R.id.dhikr_name, dhikr.title);
        views.setTextViewTextSize(R.id.dhikr_count, TypedValue.COMPLEX_UNIT_SP, COUNT_SP);
        views.setTextViewText(R.id.dhikr_count, line);
        views.setViewVisibility(R.id.dhikr_add, LiveData.canTap(shown, dhikr.of) ? View.VISIBLE : View.GONE);
        views.setContentDescription(R.id.dhikr_root, dhikr.title + ", " + line);
        views.setOnClickPendingIntent(R.id.dhikr_root, tap(context, dhikr.key));
        return views;
    }

    private static PendingIntent tap(Context context, String key) {
        Intent intent = new Intent(context, DhikrWidget.class).setAction(ACTION_TAP).putExtra(EXTRA_KEY, key)
                .addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent openModes(Context context) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(MODES_LINK), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 5, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
