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
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

import io.sentry.react.RNSentrySDK

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
    // 2026-08-22: must run before anything else in this method. initSentry() in JS
    // (app/_layout.tsx) only starts once the JS bundle has loaded and executed — which
    // is *after* SoLoader.init/new-arch bring-up below — so it can never see a crash in
    // this method. This native init (reads android/app/src/main/assets/sentry.options.json,
    // same DSN as the JS init) closes that blind spot: it was the reason the actual
    // v3.0.1/v3.0.2 splash crash (a "react"/"react-native-renderer" version mismatch —
    // see package.json) had to be root-caused via a physically connected device's logcat
    // instead of a Sentry report.
    try {
      RNSentrySDK.init(this)
    } catch (_: Throwable) { /* sentry.options.json missing/invalid — don't block startup */ }
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      initNewArchitecture()
    }
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  // 2026-08-22: replaces a two-deep reflection/retry chain that reflected into RN's
  // internal, Kotlin-name-mangled loadWithFeatureFlags() and, on failure, fell back to
  // DefaultNewArchitectureEntryPoint.load() — which calls override() again and can throw
  // the exact same "Feature flags cannot be overridden more than once" error a second
  // time, landing in a last-resort branch that could silently skip loading the new-arch
  // SO entirely (still no crash, but a half-initialized Fabric/TurboModules runtime —
  // indistinguishable from "still crashes at launch" to a user). That prior version was
  // itself already a fix for the 3.0.0 vc39 store/EAS binary dying on this exact line.
  // This version calls override() exactly once via RN's stable PUBLIC API (no reflection
  // into an internal, mangled method name), and always sets the Fabric/TurboModules
  // fields + loads the SO regardless of whether override() itself succeeded, so a lost
  // race against anything else touching feature flags degrades to "wrong flags" rather
  // than "native library never loaded."
  private fun initNewArchitecture() {
    try {
      ReactNativeFeatureFlags.dangerouslyReset()
    } catch (_: Throwable) { /* already at defaults */ }

    try {
      ReactNativeFeatureFlags.override(AppFeatureFlags())
    } catch (_: Throwable) {
      // Something else in-process already overrode (or read) the flags first —
      // leave its values in place rather than risk throwing a second time.
    }

    try {
      val ep = DefaultNewArchitectureEntryPoint::class.java
      for (name in arrayOf("privateFabricEnabled", "privateTurboModulesEnabled", "privateConcurrentReactEnabled", "privateBridgelessEnabled")) {
        val f = ep.getDeclaredField(name)
        f.isAccessible = true
        f.setBoolean(DefaultNewArchitectureEntryPoint, true)
      }
    } catch (_: Throwable) { /* MainActivity reads these; harmless if unset */ }

    try {
      val so = Class.forName("com.facebook.react.defaults.DefaultSoLoader")
      so.getDeclaredMethod("maybeLoadSoLibrary").apply { isAccessible = true }.invoke(null)
    } catch (_: Throwable) { /* appmodules SO may already be loaded */ }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
