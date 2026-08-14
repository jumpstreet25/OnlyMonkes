package com.onlymonkes.app

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * DirectNotifModule
 *
 * Bypasses expo-notifications' native pipeline (which adds groupKey=silent to all
 * local notifications, suppressing heads-up banners). Calls Android's
 * NotificationCompat API directly so notifications land on the correct channel
 * with the correct importance level.
 *
 * Chat banners use MessagingStyle + RemoteInput Reply (X/WhatsApp shade) and
 * the same zero-UI headless XMTP path as 🍌/👍 reactions.
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
        const val EXTRA_CHANNEL_ID = "om_channel_id"
        const val EXTRA_SENDER_NAME = "om_sender_name"
        const val EXTRA_BODY = "om_body"
        const val EXTRA_SENT_AT = "om_sent_at"
        const val KEY_TEXT_REPLY = "om_remote_reply"
        const val ACTION_REACT = "com.onlymonkes.app.ACTION_REACT"
        const val ACTION_REPLY = "com.onlymonkes.app.ACTION_REPLY"

        // Reply takes a slot; keep two reacts so the expanded shade stays at 3.
        private val QUICK_REACTIONS = listOf("🍌", "👍")

        private val YOU = Person.Builder().setName("You").setKey("self").build()

        private data class PostedChat(
            val notificationId: Int,
            val channelId: String,
            val senderName: String,
            val body: String,
            val sentAt: Long,
            val messageId: String,
            val conversationId: String,
            val outgoing: List<String> = emptyList(),
            val senderBitmap: Bitmap? = null,
        )

        private val posted = ConcurrentHashMap<Int, PostedChat>()
        private val io = Executors.newSingleThreadExecutor()
        private val main = Handler(Looper.getMainLooper())

        fun appendOutgoingReply(ctx: Context, notificationId: Int, replyText: String) {
            val prev = posted[notificationId] ?: return
            val next = prev.copy(outgoing = prev.outgoing + replyText)
            posted[notificationId] = next
            if (!canPost(ctx)) return
            NotificationManagerCompat.from(ctx).notify(notificationId, buildChatNotification(ctx, next))
        }

        private fun canPost(ctx: Context): Boolean {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return ContextCompat.checkSelfPermission(
                    ctx, Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
            }
            return true
        }

        private fun fetchAvatar(url: String): Bitmap? {
            if (url.isBlank() || !url.startsWith("https://")) return null
            return try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 1500
                conn.readTimeout = 1500
                conn.instanceFollowRedirects = true
                conn.inputStream.use { stream ->
                    val bmp = BitmapFactory.decodeStream(stream) ?: return null
                    val scaled = Bitmap.createScaledBitmap(bmp, 128, 128, true)
                    if (scaled != bmp) bmp.recycle()
                    scaled
                }
            } catch (_: Exception) {
                null
            }
        }

        private fun senderPerson(name: String, avatar: Bitmap?): Person {
            val b = Person.Builder().setName(name).setKey(name).setImportant(true)
            if (avatar != null) b.setIcon(IconCompat.createWithBitmap(avatar))
            return b.build()
        }

        private fun contentPendingIntent(ctx: Context, extras: Map<String, String> = emptyMap()): PendingIntent? {
            val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
            launchIntent.setPackage(null)
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            for ((k, v) in extras) launchIntent.putExtra(k, v)
            return PendingIntent.getActivity(
                ctx, extras.hashCode(), launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun replyAction(ctx: Context, chat: PostedChat): NotificationCompat.Action {
            val remoteInput = RemoteInput.Builder(KEY_TEXT_REPLY)
                .setLabel("Reply")
                .build()
            val intent = Intent(ctx, ReactionActionReceiver::class.java).apply {
                action = ACTION_REPLY
                putExtra(EXTRA_MESSAGE_ID, chat.messageId)
                putExtra(EXTRA_CONVERSATION_ID, chat.conversationId)
                putExtra(EXTRA_NOTIFICATION_ID, chat.notificationId)
                putExtra(EXTRA_CHANNEL_ID, chat.channelId)
                putExtra(EXTRA_SENDER_NAME, chat.senderName)
                putExtra(EXTRA_BODY, chat.body)
                putExtra(EXTRA_SENT_AT, chat.sentAt)
            }
            // Android 12+ requires MUTABLE so the OS can attach RemoteInput results.
            val pi = PendingIntent.getBroadcast(
                ctx, chat.notificationId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            return NotificationCompat.Action.Builder(0, "Reply", pi)
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(true)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build()
        }

        private fun reactionActions(ctx: Context, chat: PostedChat): List<NotificationCompat.Action> {
            return QUICK_REACTIONS.mapIndexed { index, emoji ->
                val intent = Intent(ctx, ReactionActionReceiver::class.java).apply {
                    action = ACTION_REACT
                    putExtra(EXTRA_MESSAGE_ID, chat.messageId)
                    putExtra(EXTRA_CONVERSATION_ID, chat.conversationId)
                    putExtra(EXTRA_EMOJI, emoji)
                    putExtra(EXTRA_NOTIFICATION_ID, chat.notificationId)
                }
                val requestCode = (chat.notificationId * 10) + index + 1
                val pi = PendingIntent.getBroadcast(
                    ctx, requestCode, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                NotificationCompat.Action.Builder(0, emoji, pi).build()
            }
        }

        private fun buildChatNotification(ctx: Context, chat: PostedChat): android.app.Notification {
            val sender = senderPerson(chat.senderName, chat.senderBitmap)
            val style = NotificationCompat.MessagingStyle(YOU)
                .setConversationTitle("OnlyMonkes")
                .setGroupConversation(true)
                .addMessage(chat.body, chat.sentAt, sender)
            for (line in chat.outgoing) {
                style.addMessage(line, System.currentTimeMillis(), YOU)
            }

            val builder = NotificationCompat.Builder(ctx, chat.channelId)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle(chat.senderName)
                .setContentText(chat.body)
                .setStyle(style)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setOnlyAlertOnce(chat.outgoing.isNotEmpty())
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .apply { contentPendingIntent(ctx)?.let { setContentIntent(it) } }
                .addAction(replyAction(ctx, chat))
            for (action in reactionActions(ctx, chat)) builder.addAction(action)
            chat.senderBitmap?.let { builder.setLargeIcon(it) }
            return builder.build()
        }
    }

    private fun canPost(): Boolean = canPost(reactContext)

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

    /** Installed applicationId (production vs canary). Used by Free-RASP. */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getPackageName(): String = reactContext.packageName

    @ReactMethod
    fun show(title: String, body: String, channelId: String) {
        buildAndPost(title, body, channelId)
    }

    @ReactMethod
    fun showDelayed(title: String, body: String, channelId: String, delayMs: Int) {
        Handler(Looper.getMainLooper()).postDelayed({
            buildAndPost(title, body, channelId)
        }, delayMs.toLong())
    }

    /**
     * Chat-message notification: MessagingStyle thread + inline Reply + 🍌/👍.
     * Reply and reacts never open the app (ReactionActionReceiver → headless JS).
     */
    @ReactMethod
    fun showWithReactions(
        title: String,
        body: String,
        channelId: String,
        messageId: String,
        conversationId: String,
        senderName: String,
        avatarUrl: String,
    ) {
        val ctx: Context = reactContext
        if (!canPost()) return
        val notificationId = System.currentTimeMillis().toInt() and 0x7FFFFFFF
        val name = senderName.ifBlank { title }
        val chat = PostedChat(
            notificationId = notificationId,
            channelId = channelId,
            senderName = name,
            body = body,
            sentAt = System.currentTimeMillis(),
            messageId = messageId,
            conversationId = conversationId,
        )
        posted[notificationId] = chat
        NotificationManagerCompat.from(ctx).notify(notificationId, buildChatNotification(ctx, chat))

        if (avatarUrl.startsWith("https://")) {
            io.execute {
                val bmp = fetchAvatar(avatarUrl) ?: return@execute
                val latest = posted[notificationId] ?: return@execute
                val withIcon = latest.copy(senderBitmap = bmp)
                posted[notificationId] = withIcon
                main.post {
                    if (!canPost(ctx)) return@post
                    NotificationManagerCompat.from(ctx).notify(
                        notificationId,
                        buildChatNotification(ctx, withIcon),
                    )
                }
            }
        }
    }

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
