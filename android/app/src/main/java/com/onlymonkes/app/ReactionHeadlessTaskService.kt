package com.onlymonkes.app

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * ReactionHeadlessTaskService
 *
 * Runs the "OnlyMonkesReaction" Headless JS Task (registered in
 * src/lib/headlessReaction.ts) with no UI. Started by ReactionActionReceiver
 * when a quick-reaction notification action is tapped.
 */
class ReactionHeadlessTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val extras = intent?.extras ?: return null
        val data = Arguments.createMap().apply {
            putString("messageId", extras.getString(DirectNotifModule.EXTRA_MESSAGE_ID))
            putString("conversationId", extras.getString(DirectNotifModule.EXTRA_CONVERSATION_ID))
            putString("emoji", extras.getString(DirectNotifModule.EXTRA_EMOJI))
        }
        return HeadlessJsTaskConfig(
            "OnlyMonkesReaction",
            data,
            10_000, // 10s timeout — matches this task's "resume + find + send, nothing else" scope
            true,   // isAllowedInForeground — must still work if the app happens to already be open
        )
    }
}
