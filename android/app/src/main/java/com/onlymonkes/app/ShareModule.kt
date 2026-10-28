package com.onlymonkes.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * "Share to OnlyMonkes" (3.1): text, links and images shared from other apps. MainActivity hands
 * every ACTION_SEND intent here; JS reads the cold-start share with getInitialShare() and later
 * ones through the "shareReceived" event. Nothing is sent — the app opens Main Chat with the text
 * in the composer or the image in photo review.
 */
class ShareModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OmShare"

    init { context = reactContext }

    @ReactMethod
    fun getInitialShare(promise: Promise) {
        val p = pending
        pending = null
        promise.resolve(p?.let { toMap(it) })
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Double) {}

    data class Shared(val type: String, val text: String?, val uri: String?, val mime: String?)

    companion object {
        @Volatile private var pending: Shared? = null
        @Volatile private var context: ReactApplicationContext? = null

        private fun toMap(s: Shared): WritableMap = Arguments.createMap().apply {
            putString("type", s.type)
            s.text?.let { putString("text", it) }
            s.uri?.let { putString("uri", it) }
            s.mime?.let { putString("mime", it) }
        }

        /** From MainActivity.onCreate / onNewIntent. */
        fun handleIntent(intent: Intent?) {
            if (intent?.action != Intent.ACTION_SEND) return
            val mime = intent.type ?: return
            val shared = when {
                mime.startsWith("image/") -> {
                    val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
                    uri?.let { Shared("image", intent.getStringExtra(Intent.EXTRA_TEXT), it.toString(), mime) }
                }
                mime.startsWith("text/") -> intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
                    ?.let { Shared("text", it.take(4000), null, mime) }
                else -> null
            } ?: return
            // Consumed once. Always held until JS collects it (getInitialShare); the event only says
            // "one is waiting", so a share during JS start-up can't be lost.
            intent.action = null
            pending = shared
            val ctx = context
            if (ctx != null && ctx.hasActiveReactInstance()) {
                try {
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("shareReceived", null)
                } catch (_: Throwable) { /* JS not ready — getInitialShare picks it up */ }
            }
        }
    }
}
