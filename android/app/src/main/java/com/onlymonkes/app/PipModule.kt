package com.onlymonkes.app

import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Picture-in-picture for Avatar / Video Rooms (3.1). While a room screen is open it calls
 * setRoomActive(true): leaving the app (Home, recents, switching apps) then shrinks the call
 * into a floating window instead of tearing the room down. MainActivity reports PiP enter/
 * exit as the "pipModeChanged" event so the room can hide its controls.
 */
class PipModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OmPip"

    private fun supported(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun params(auto: Boolean): PictureInPictureParams {
        val b = PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setAutoEnterEnabled(auto).setSeamlessResizeEnabled(false)
        return b.build()
    }

    @ReactMethod
    fun isSupported(promise: Promise) = promise.resolve(supported())

    @ReactMethod
    fun setRoomActive(active: Boolean) {
        roomActive = active
        val activity = reactContext.currentActivity ?: return
        if (!supported()) return
        activity.runOnUiThread {
            try { activity.setPictureInPictureParams(params(active)) } catch (_: Throwable) { /* not in a PiP-capable state */ }
        }
    }

    @ReactMethod
    fun enter(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null || !supported()) { promise.resolve(false); return }
        activity.runOnUiThread {
            promise.resolve(try { activity.enterPictureInPictureMode(params(roomActive)) } catch (_: Throwable) { false })
        }
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Double) {}

    companion object {
        /** Read by MainActivity.onUserLeaveHint (pre-Android 12 auto-enter). */
        @Volatile var roomActive = false
        @Volatile private var context: ReactApplicationContext? = null

        fun emitModeChanged(inPip: Boolean) {
            try {
                context?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("pipModeChanged", inPip)
            } catch (_: Throwable) { /* JS not ready */ }
        }
    }

    init { context = reactContext }
}
