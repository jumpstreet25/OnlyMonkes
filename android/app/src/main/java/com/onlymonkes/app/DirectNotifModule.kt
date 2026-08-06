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
 *
 * 2026-07-23: extended with two action-button flows:
 *  - showWithReactions(): quick-reaction buttons that fire a BroadcastReceiver
 *    (ReactionActionReceiver) instead of opening any Activity, which starts a
 *    React Native Headless JS Task to send the reaction with zero UI. See
 *    src/lib/headlessReaction.ts for the JS side.
 *  - showWithJoinAction(): a "Join" button for room invites. This does open
 *    the app (there's no meaningful zero-UI way to join a live room) —
 *    deliberately NOT wired to deep-link into the specific room via extras;
 *    the app's normal XMTP sync already surfaces the live-room pill once
 *    open if the room is still active, same as if the user had opened the
 *    app on their own. The room-id extras are carried on the intent for a
 *    future direct-deep-link pass, currently unread by the JS side.
 */
class DirectNotifModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "DirectNotif"

    companion object {
        const val EXTRA_MESSAGE_ID = "om_message_id"
        const val EXTRA_CONVERSATION_ID = "om_conversation_id"
        const val EXTRA_EMOJI = "om_emoji"
        const val EXTRA_NOTIFICATION_ID = "om_notification_id"
        const val EXTRA_ROOM_TYPE = "om_room_type"
        const val EXTRA_ROOM_ID = "om_room_id"
        const val ACTION_REACT = "com.onlymonkes.app.ACTION_REACT"

        // Fixed 3-button reaction set — matches the app's brand voice (see
        // CLAUDE.md persona notes) rather than a generic thumbs/heart/laugh
        // set. Kept small deliberately: Android reliably shows ~3 actions
        // inline before needing an expand tap, and every extra action is
        // another PendingIntent to keep unique across notification posts.
        private val QUICK_REACTIONS = listOf("👍", "❤️", "🍌")
    }

    private fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(
                reactContext, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    private fun contentPendingIntent(ctx: Context, extras: Map<String, String> = emptyMap()): PendingIntent? {
        val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
        launchIntent.setPackage(null) // avoid FLAG_ACTIVITY_NEW_TASK conflicts on some OEMs
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        for ((k, v) in extras) launchIntent.putExtra(k, v)
        return PendingIntent.getActivity(
            ctx, extras.hashCode(), launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun buildAndPost(title: String, body: String, channelId: String) {
        if (!canPost()) return
        val ctx: Context = reactContext
        val notificationId = System.currentTimeMillis().toInt() and 0x7FFFFFFF

        val notif = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .apply { contentPendingIntent(ctx)?.let { setContentIntent(it) } }
            .build()

        NotificationManagerCompat.from(ctx).notify(notificationId, notif)
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

    /**
     * Chat-message notification with quick-reaction action buttons that
     * never open the app — each fires ReactionActionReceiver, which hands
     * off to a Headless JS Task (src/lib/headlessReaction.ts).
     */
    @ReactMethod
    fun showWithReactions(title: String, body: String, channelId: String, messageId: String, conversationId: String) {
        val ctx: Context = reactContext
        // Reserve the notification ID before building actions so the
        // receiver can update/dismiss the exact notification that was
        // reacted to (System.currentTimeMillis() again inside buildAndPost
        // would generate a DIFFERENT id — compute it once, here).
        val notificationId = System.currentTimeMillis().toInt() and 0x7FFFFFFF

        val actions = QUICK_REACTIONS.mapIndexed { index, emoji ->
            val intent = Intent(ctx, ReactionActionReceiver::class.java).apply {
                action = ACTION_REACT
                putExtra(EXTRA_MESSAGE_ID, messageId)
                putExtra(EXTRA_CONVERSATION_ID, conversationId)
                putExtra(EXTRA_EMOJI, emoji)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            }
            // Unique request code per (notification, emoji) — otherwise
            // Android collapses distinct PendingIntents with equal
            // action+extras into the same one across different notifications.
            val requestCode = (notificationId * 10) + index
            val pi = PendingIntent.getBroadcast(
                ctx, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            NotificationCompat.Action.Builder(0, emoji, pi).build()
        }

        if (!canPost()) return
        val builder = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .apply { contentPendingIntent(ctx)?.let { setContentIntent(it) } }
        for (action in actions) builder.addAction(action)
        NotificationManagerCompat.from(ctx).notify(notificationId, builder.build())
    }

    /**
     * Live/Avatar room invite notification with a "Join" action button.
     * Both the button and the notification body itself open the app and
     * deep-link into the room via MainActivity.onNewIntent — there is no
     * meaningful zero-UI action for joining a live room.
     */
    @ReactMethod
    fun showWithJoinAction(title: String, body: String, channelId: String, roomType: String, roomId: String) {
        val ctx: Context = reactContext
        if (!canPost()) return
        val extras = mapOf(EXTRA_ROOM_TYPE to roomType, EXTRA_ROOM_ID to roomId)
        val pi = contentPendingIntent(ctx, extras)

        val joinAction = pi?.let {
            NotificationCompat.Action.Builder(0, "Join", it).build()
        }

        val notificationId = System.currentTimeMillis().toInt() and 0x7FFFFFFF
        val builder = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .apply { pi?.let { setContentIntent(it) } }
        joinAction?.let { builder.addAction(it) }
        NotificationManagerCompat.from(ctx).notify(notificationId, builder.build())
    }
}
