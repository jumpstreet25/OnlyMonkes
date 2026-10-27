package com.onlymonkes.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/**
 * Live trade updates (3.1). The bot pushes a bag's progress (data-only FCM, type
 * om_live_trade); JS calls show() with it. Android 16+: a promoted Live Update with
 * ProgressStyle — segments stop→entry (red), entry→T1 (green), T1→T2 (gold), points at entry/T1/T2,
 * the P&L as the status-bar chip. Older Android: an ongoing notification with a progress bar.
 */
class LiveUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OmLiveUpdate"

    private val channelId = "om_live_trade_v1"
    private val scale = 1000

    private fun ensureChannel(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(channelId) == null) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Live trades", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Your open bags: stop, entry, T1 and T2 at a glance"
                    setSound(null, null)
                    enableVibration(false)
                },
            )
        }
    }

    private fun tapIntent(ctx: Context): PendingIntent? {
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        launch.putExtra("open", "portfolio")
        return PendingIntent.getActivity(ctx, 9_101, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    @ReactMethod
    fun show(id: String, d: ReadableMap) {
        val ctx = reactContext.applicationContext
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannel(nm)
        val sym = d.getString("sym") ?: "?"
        val pnl = d.getDouble("pnl")
        val price = d.getDouble("price"); val entry = d.getDouble("entry"); val stop = d.getDouble("stop")
        val t1 = d.getDouble("t1"); val t2 = d.getDouble("t2")
        val t1Hit = d.getBoolean("t1Hit"); val t2Hit = d.getBoolean("t2Hit")
        val chip = (if (pnl >= 0) "+" else "") + String.format("%.1f%%", pnl)
        val title = "\$$sym $chip"
        val text = when {
            t2Hit -> "T2 hit — trailing the rest"
            t1Hit -> "T1 hit · next T2 ${fmt(t2)} SOL"
            else -> "T1 ${fmt(t1)} · T2 ${fmt(t2)} SOL"
        }

        // Map prices onto 0..scale between the lowest and highest level on the bar.
        val lo = minOf(stop.takeIf { it > 0 } ?: entry, entry, price)
        val hi = maxOf(t2, t1, price, entry * 1.0001)
        fun at(x: Double) = (((x - lo) / (hi - lo)) * scale).toInt().coerceIn(0, scale)
        val pEntry = at(entry); val pT1 = at(t1).coerceAtLeast(pEntry); val pT2 = at(t2).coerceAtLeast(pT1)
        val progress = at(price)
        val id32 = id.hashCode()

        val notif: Notification = if (Build.VERSION.SDK_INT >= 36) {
            val segs = mutableListOf<Notification.ProgressStyle.Segment>()
            if (pEntry > 0) segs += Notification.ProgressStyle.Segment(pEntry).setColor(Color.parseColor("#E5484D"))
            if (pT1 > pEntry) segs += Notification.ProgressStyle.Segment(pT1 - pEntry).setColor(Color.parseColor("#30A46C"))
            if (pT2 > pT1) segs += Notification.ProgressStyle.Segment(pT2 - pT1).setColor(Color.parseColor("#F5C542"))
            if (scale > pT2) segs += Notification.ProgressStyle.Segment(scale - pT2).setColor(Color.parseColor("#7C5CFC"))
            val points = listOf(pEntry, pT1, pT2).distinct().filter { it in 1 until scale }
                .map { Notification.ProgressStyle.Point(it).setColor(Color.WHITE) }
            val style = Notification.ProgressStyle()
                .setProgressSegments(segs)
                .setProgressPoints(points)
                .setProgress(progress)
            Notification.Builder(ctx, channelId)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(style)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShortCriticalText(chip)
                .setContentIntent(tapIntent(ctx))
                .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
                .build()
        } else {
            NotificationCompat.Builder(ctx, channelId)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle(title)
                .setContentText(text)
                .setProgress(scale, progress, false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(tapIntent(ctx))
                .build()
        }
        try { nm.notify(TAG, id32, notif) } catch (_: SecurityException) { /* notifications off */ }
    }

    @ReactMethod
    fun close(id: String) {
        val nm = reactContext.applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(TAG, id.hashCode())
    }

    private fun fmt(x: Double): String =
        if (x <= 0) "—" else java.math.BigDecimal(x).round(java.math.MathContext(3)).stripTrailingZeros().toPlainString()

    companion object { private const val TAG = "om_live_trade" }
}
