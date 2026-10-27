package com.onlymonkes.app

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** JS → home-screen widget: store the snapshot (JSON) and redraw every placed widget. */
class WidgetModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OmWidget"

    @ReactMethod
    fun update(json: String) {
        val ctx = reactContext.applicationContext
        ctx.getSharedPreferences(ChatWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
            .putString(ChatWidgetProvider.KEY, json).apply()
        ChatWidgetProvider.refreshAll(ctx)
    }
}
