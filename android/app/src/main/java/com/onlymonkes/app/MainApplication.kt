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
      // Expo/SoLoader can set RN feature flags before this line. Both
      // load() and loadWithFeatureFlags() call override() and crash with
      // "Feature flags cannot be overridden more than once" if we don't
      // reset first (the 3.0.0 vc39 store/EAS binary dies here).
      try {
        ReactNativeFeatureFlags.dangerouslyReset()
      } catch (_: Exception) { /* already default */ }

      // loadWithFeatureFlags is `internal` — reflect by prefix + param type
      // because Kotlin mangles the JVM name (`loadWithFeatureFlags$…`).
      try {
        val method = DefaultNewArchitectureEntryPoint::class.java.declaredMethods.firstOrNull {
          it.name.startsWith("loadWithFeatureFlags") &&
            it.parameterTypes.size == 1 &&
            it.parameterTypes[0] == ReactNativeFeatureFlagsProvider::class.java
        }
        if (method != null) {
          method.isAccessible = true
          method.invoke(null, AppFeatureFlags())
        } else {
          DefaultNewArchitectureEntryPoint.load()
        }
      } catch (_: Exception) {
        try {
          DefaultNewArchitectureEntryPoint.load()
        } catch (_: Exception) {
          // Flags were already set and reset failed — still enable Fabric
          // fields MainActivity reads, then load the new-arch SO.
          try {
            val ep = DefaultNewArchitectureEntryPoint::class.java
            for (name in arrayOf("privateFabricEnabled", "privateTurboModulesEnabled", "privateConcurrentReactEnabled", "privateBridgelessEnabled")) {
              val f = ep.getDeclaredField(name)
              f.isAccessible = true
              f.setBoolean(DefaultNewArchitectureEntryPoint, true)
            }
            val so = Class.forName("com.facebook.react.defaults.DefaultSoLoader")
            so.getDeclaredMethod("maybeLoadSoLibrary").apply { isAccessible = true }.invoke(null)
          } catch (_: Exception) { /* continue; host may already be loaded */ }
        }
      }
    }
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
