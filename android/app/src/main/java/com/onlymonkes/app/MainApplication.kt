package com.onlymonkes.app

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
        this,
        object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> {
            val packages = PackageList(this).packages
            packages.add(DirectNotifPackage())
            packages.add(DeviceAttestPackage())
            packages.add(SentimentWorkPackage())
            return packages
          }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
          override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // DefaultNewArchitectureEntryPoint.load() always calls
      // ReactNativeFeatureFlags.override() internally (it throws if called
      // twice), so a custom flag (see AppFeatureFlags.kt) can only be
      // injected via loadWithFeatureFlags() — but that's `internal` in
      // Kotlin and won't compile against directly (confirmed via a real EAS
      // build failure). Kotlin's `internal` is compile-time only though —
      // the underlying JVM method (marked @JvmStatic) is genuinely public —
      // so reflection reaches it. This also correctly sets
      // DefaultNewArchitectureEntryPoint's private fabricEnabled/
      // turboModulesEnabled/etc. fields, which MainActivity.kt reads.
      //
      // 2026-08-05: was looking up the method by its plain name
      // ("loadWithFeatureFlags") — crashed every launch of the OnlyMonkes
      // 3.0 build with NoSuchMethodException. Kotlin mangles `internal`
      // members with a module-name suffix at the bytecode level (confirmed
      // via javap on the real react-android-0.81.5 AAR: the method is
      // actually named `loadWithFeatureFlags$ReactAndroid_release`). That
      // suffix is compiler/module-name derived and not guaranteed stable
      // across RN versions, so match by prefix + parameter type instead of
      // a hardcoded mangled name.
      try {
        val method = DefaultNewArchitectureEntryPoint::class.java.declaredMethods.firstOrNull {
          it.name.startsWith("loadWithFeatureFlags") &&
            it.parameterTypes.size == 1 &&
            it.parameterTypes[0] == ReactNativeFeatureFlagsProvider::class.java
        } ?: throw NoSuchMethodException("loadWithFeatureFlags* not found on DefaultNewArchitectureEntryPoint")
        method.isAccessible = true
        method.invoke(null, AppFeatureFlags())
      } catch (e: Exception) {
        throw RuntimeException("Failed to invoke loadWithFeatureFlags via reflection", e)
      }
    }
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
