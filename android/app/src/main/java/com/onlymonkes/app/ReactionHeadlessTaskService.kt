package com.onlymonkes.app

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the "OnlyMonkesReaction" Headless JS Task (src/lib/headlessReaction.ts)
 * with no UI. Used for both quick-react and inline Reply.
 */
class ReactionHeadlessTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val extras = intent?.extras ?: return null
        val data = Arguments.createMap().apply {
            putString("kind", extras.getString(EXTRA_KIND) ?: "react")
            putString("messageId", extras.getString(DirectNotifModule.EXTRA_MESSAGE_ID))
            putString("conversationId", extras.getString(DirectNotifModule.EXTRA_CONVERSATION_ID))
            putString("emoji", extras.getString(DirectNotifModule.EXTRA_EMOJI))
            putString("replyText", extras.getString(EXTRA_REPLY_TEXT))
        }
        return HeadlessJsTaskConfig(
            "OnlyMonkesReaction",
            data,
            15_000,
            true,
        )
    }

    companion object {
        const val EXTRA_KIND = "om_kind"
        const val EXTRA_REPLY_TEXT = "om_reply_text"
    }
}
