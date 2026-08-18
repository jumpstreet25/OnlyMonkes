package com.onlymonkes.app

import android.content.Context
import android.content.Intent
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.facebook.react.HeadlessJsTaskService

/**
 * WorkManager-triggered periodic upload of locally-queued sentiment engagement events.
 * Fires the same HeadlessJsTaskService pattern already used for notification reactions
 * (ReactionHeadlessTaskService/ReactionActionReceiver) rather than a foreground service —
 * see DeviceAttestModule.kt's doc comment: Android 15+ caps `dataSync` foreground services
 * at 6h/24h and blocks background self-launch entirely, and WorkManager's own execution
 * window is one of the documented exemptions to the background-service-start restriction
 * that a plain `startService()` call would otherwise hit.
 */
class SentimentSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        return try {
            HeadlessJsTaskService.acquireWakeLockNow(applicationContext)
            val serviceIntent = Intent(applicationContext, SentimentHeadlessTaskService::class.java)
            applicationContext.startService(serviceIntent)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
