package com.onlymonkes.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.facebook.react.HeadlessJsTaskService

/**
 * ReactionActionReceiver
 *
 * Handles 🍌/👍 taps and MessagingStyle RemoteInput Reply from
 * DirectNotifModule. BroadcastReceiver (not Activity) so the app UI never
 * appears. Reply text is read via RemoteInput.getResultsFromIntent.
 */
class ReactionActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            DirectNotifModule.ACTION_REACT -> handleReact(context, intent)
            DirectNotifModule.ACTION_REPLY -> handleReply(context, intent)
        }
    }

    private fun handleReact(context: Context, intent: Intent) {
        HeadlessJsTaskService.acquireWakeLockNow(context)
        val serviceIntent = Intent(context, ReactionHeadlessTaskService::class.java).apply {
            putExtras(intent)
            putExtra(ReactionHeadlessTaskService.EXTRA_KIND, "react")
        }
        context.startService(serviceIntent)

        val notificationId = intent.getIntExtra(DirectNotifModule.EXTRA_NOTIFICATION_ID, -1)
        if (notificationId != -1) {
            NotificationManagerCompat.from(context).cancel(notificationId)
        }
    }

    private fun handleReply(context: Context, intent: Intent) {
        val results = RemoteInput.getResultsFromIntent(intent)
        val text = results?.getCharSequence(DirectNotifModule.KEY_TEXT_REPLY)
            ?.toString()
            ?.trim()
            .orEmpty()
            .take(500)
        if (text.isEmpty()) return

        HeadlessJsTaskService.acquireWakeLockNow(context)
        val serviceIntent = Intent(context, ReactionHeadlessTaskService::class.java).apply {
            putExtras(intent)
            putExtra(ReactionHeadlessTaskService.EXTRA_KIND, "reply")
            putExtra(ReactionHeadlessTaskService.EXTRA_REPLY_TEXT, text)
        }
        context.startService(serviceIntent)

        val notificationId = intent.getIntExtra(DirectNotifModule.EXTRA_NOTIFICATION_ID, -1)
        if (notificationId != -1) {
            // X-style: keep the thread in the shade and append "You: …"
            DirectNotifModule.appendOutgoingReply(context, notificationId, text)
        }
    }
}
