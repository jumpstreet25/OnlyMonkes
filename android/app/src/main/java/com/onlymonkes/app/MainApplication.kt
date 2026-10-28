package com.onlymonkes.app

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

import io.sentry.react.RNSentrySDK

import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.AudioType

// 3.1 (Expo 58 / RN 0.88): the Expo template's ReactHost + loadReactNative replace the
// old ReactNativeHost, SoLoader.init(OpenSourceMergedSoMapping) and the reflection-based
// new-architecture bring-up. AppFeatureFlags is gone: RN 0.88 removed useRawPropsJsiValue /
// useShadowNodeStateOnClone (always on now — vision-camera's PreviewView needed them).
class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(DirectNotifPackage())
          add(DeviceAttestPackage())
          add(SentimentWorkPackage())
          add(PipPackage())
          add(LiveUpdatePackage())
          add(WidgetPackage())
          add(SharePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    // 2026-08-25: LiveKit's teardown (fired on every ReactInstance.destroy(), including an
    // OTA reload) throws if setup() never ran. LiveKit's docs: above any other RN init.
    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())
    // 2026-08-22: native Sentry init sees crashes before the JS bundle loads.
    try {
      RNSentrySDK.init(this)
    } catch (_: Throwable) { /* sentry.options.json missing/invalid — don't block startup */ }
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
