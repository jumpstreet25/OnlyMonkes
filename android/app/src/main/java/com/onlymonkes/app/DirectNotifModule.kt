package com.onlymonkes.app

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * DirectNotifModule
 *
 * Bypasses expo-notifications' native pipeline (which adds groupKey=silent to all
 * local notifications, suppressing heads-up banners). Calls Android's
 * NotificationCompat API directly so notifications land on the correct channel
 * with the correct importance level.
 */
class DirectNotifModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "DirectNotif"

    private fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(
                reactContext, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    private fun buildAndPost(title: String, body: String, channelId: String) {
        if (!canPost()) return
        val ctx: Context = reactContext

        val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pi = launchIntent?.let {
            PendingIntent.getActivity(
                ctx, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val notif = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .apply { pi?.let { setContentIntent(it) } }
            .build()

        NotificationManagerCompat.from(ctx)
            .notify(System.currentTimeMillis().toInt() and 0x7FFFFFFF, notif)
    }

    /** Show immediately — call from JS while app is backgrounded. */
    @ReactMethod
    fun show(title: String, body: String, channelId: String) {
        buildAndPost(title, body, channelId)
    }

    /**
     * Show after delayMs milliseconds via Handler.postDelayed.
     * Reliable as long as the app process survives (backgrounded but not killed).
     * Used by the test button — gives time to swipe home before the banner fires.
     */
    @ReactMethod
    fun showDelayed(title: String, body: String, channelId: String, delayMs: Int) {
        Handler(Looper.getMainLooper()).postDelayed({
            buildAndPost(title, body, channelId)
        }, delayMs.toLong())
    }
}
