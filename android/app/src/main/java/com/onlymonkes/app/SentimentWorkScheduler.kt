package com.onlymonkes.app

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.TimeUnit

/**
 * JS-facing control for the periodic sentiment-batch upload (SentimentSyncWorker). Called
 * from src/hooks/useSentimentOptIn.ts on toggle. WorkManager's minimum periodic interval is
 * 15 minutes — 30 minutes here is safely above that floor and battery-conscious.
 */
class SentimentWorkScheduler(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "SentimentWorkScheduler"

    companion object {
        private const val UNIQUE_WORK_NAME = "onlymonkes_sentiment_sync"
    }

    @ReactMethod
    fun schedulePeriodicUpload(promise: Promise) {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<SentimentSyncWorker>(30, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES)
                .build()
            // KEEP, not REPLACE — toggling opt-in on repeatedly (e.g. app restarts while
            // already opted in) must not reset the schedule's phase/backoff state.
            WorkManager.getInstance(reactContext).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SENTIMENT_SCHEDULE_ERROR", e)
        }
    }

    @ReactMethod
    fun cancelPeriodicUpload(promise: Promise) {
        try {
            WorkManager.getInstance(reactContext).cancelUniqueWork(UNIQUE_WORK_NAME)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SENTIMENT_CANCEL_ERROR", e)
        }
    }
}
