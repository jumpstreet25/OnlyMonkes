package com.onlymonkes.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.views.view.setEdgeToEdgeFeatureFlagOn

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    // 2026-08-03: must run BEFORE super.onCreate() — ReactActivityDelegate.onCreate()
    // only calls RN's own Window.enableEdgeToEdge() when this flag is already on
    // (checked at ReactActivityDelegate.java:140). The previous approach called
    // WindowCompat.setDecorFitsSystemWindows(window, false) manually AFTER
    // super.onCreate(), which is a strict subset of what RN's enableEdgeToEdge()
    // does — it's missing `isStatusBarContrastEnforced = false` (Android Q+),
    // so the OS was still drawing its automatic contrast scrim behind the status
    // bar, i.e. the "visible bar" that was supposed to be gone. Flipping this
    // flag also fixes every other RN/Expo component that reads it to know
    // edge-to-edge is active — DeviceInfo.isEdgeToEdge (checked by
    // expo-status-bar via react-native-is-edge-to-edge), StatusBarModule, and
    // ReactModalHostView's inset handling — instead of only fixing the window
    // itself and leaving those consumers thinking edge-to-edge is off.
    setEdgeToEdgeFeatureFlagOn()
    super.onCreate(null)
    // 2026-07-23: explicit, version-independent edge-to-edge enforcement.
    // android:windowOptOutEdgeToEdgeEnforcement=false (styles.xml) only gets
    // Android to STOP blocking edge-to-edge on API 35+ — below that (down to
    // this app's minSdkVersion 26) there is no automatic OS enforcement at
    // all, so without this explicit call the window still reserves its own
    // space for the system bars on any pre-Android-15 device.
    WindowCompat.setDecorFitsSystemWindows(window, false)
    // 2026-07-23: full immersive mode — hide status + gesture-nav bars
    // entirely (swipe-revealed, auto-rehides) to reclaim the space
    // edge-to-edge alone still left reserved for them.
    WindowInsetsControllerCompat(window, window.decorView).let { controller ->
      controller.hide(WindowInsetsCompat.Type.systemBars())
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    // Re-hide after focus regain (e.g. a dialog or the keyboard closing) —
    // transient swipe-reveal only lasts until focus changes again otherwise.
    if (hasFocus) {
      WindowInsetsControllerCompat(window, window.decorView).hide(WindowInsetsCompat.Type.systemBars())
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
