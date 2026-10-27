package com.onlymonkes.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/**
 * OnlyMonkes home-screen widget (3.1): Main Chat, DMs, MonkeTrades — latest line + unread.
 * JS writes a snapshot through WidgetModule (OmWidget.update); this only renders it, so it
 * costs nothing between updates (updatePeriodMillis = 0). Each row opens its screen through
 * the app's own deep links (onlymonkes://chat, ://dms, ://trades).
 */
class ChatWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        render(context, manager, ids)
    }

    companion object {
        const val PREFS = "om_widget"
        const val KEY = "snapshot"

        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ChatWidgetProvider::class.java))
            if (ids.isNotEmpty()) render(context, manager, ids)
        }

        private fun open(context: Context, path: String, code: Int): PendingIntent {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("onlymonkes://$path"))
                .setPackage(context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val snap = try {
                JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}") ?: "{}")
            } catch (_: Throwable) { JSONObject() }
            val views = RemoteViews(context.packageName, R.layout.om_widget)
            fun row(key: String, lineId: Int, badgeId: Int) {
                val o = snap.optJSONObject(key)
                val line = o?.optString("line").orEmpty()
                views.setTextViewText(lineId, line.ifEmpty { context.getString(R.string.om_widget_empty) })
                val unread = o?.optInt("unread", 0) ?: 0
                if (unread > 0) {
                    views.setTextViewText(badgeId, if (unread > 99) "99+" else unread.toString())
                    views.setViewVisibility(badgeId, View.VISIBLE)
                } else {
                    views.setViewVisibility(badgeId, View.GONE)
                }
            }
            row("main", R.id.main_line, R.id.main_badge)
            row("dms", R.id.dms_line, R.id.dms_badge)
            row("trades", R.id.trades_line, R.id.trades_badge)
            val at = snap.optLong("updatedAt", 0L)
            views.setTextViewText(R.id.om_widget_updated, if (at > 0) DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at)) else "")
            views.setOnClickPendingIntent(R.id.main_row, open(context, "chat", 9_201))
            views.setOnClickPendingIntent(R.id.dms_row, open(context, "dms", 9_202))
            views.setOnClickPendingIntent(R.id.trades_row, open(context, "trades", 9_203))
            for (id in ids) manager.updateAppWidget(id, views)
        }
    }
}
