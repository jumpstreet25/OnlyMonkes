package com.onlymonkes.app

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the "OnlyMonkesSentimentUpload" Headless JS Task (src/lib/sentimentUploadTask.ts)
 * with no UI — reads the locally-queued engagement events (src/lib/sentimentSignal.ts),
 * signs a batch via DeviceAttestModule, and POSTs it to the worker's
 * /api/sentiment/ingest. Same pattern as ReactionHeadlessTaskService, triggered by
 * SentimentSyncWorker (WorkManager) instead of a notification action.
 */
class SentimentHeadlessTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
        return HeadlessJsTaskConfig(
            "OnlyMonkesSentimentUpload",
            Arguments.createMap(),
            45_000,
            true,
        )
    }
}
