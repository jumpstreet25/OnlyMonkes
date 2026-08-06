package com.onlymonkes.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.HeadlessJsTaskService

/**
 * ReactionActionReceiver
 *
 * Handles a tap on one of the quick-reaction buttons added by
 * DirectNotifModule.showWithReactions(). Deliberately a BroadcastReceiver,
 * not an Activity — the whole point is that the app UI never appears.
 *
 * Per HeadlessJsTaskService's own doc comment: a wake lock must be acquired
 * here, synchronously, before onReceive() returns — the device could
 * otherwise fall back asleep before ReactionHeadlessTaskService gets a
 * chance to actually start.
 */
class ReactionActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DirectNotifModule.ACTION_REACT) return

        HeadlessJsTaskService.acquireWakeLockNow(context)

        val serviceIntent = Intent(context, ReactionHeadlessTaskService::class.java).apply {
            putExtras(intent)
        }
        context.startService(serviceIntent)

        // Dismiss the notification immediately rather than leaving it sitting
        // there with dead action buttons. Fire-and-forget — this doesn't wait
        // for the headless task to actually succeed, but a failed background
        // reaction is rare and non-fatal (see headlessReaction.ts).
        val notificationId = intent.getIntExtra(DirectNotifModule.EXTRA_NOTIFICATION_ID, -1)
        if (notificationId != -1) {
            NotificationManagerCompat.from(context).cancel(notificationId)
        }
    }
}
