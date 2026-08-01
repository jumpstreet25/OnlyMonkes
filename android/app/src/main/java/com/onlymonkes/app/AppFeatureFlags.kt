package com.onlymonkes.app

import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android

/**
 * react-native-vision-camera 5's PreviewView crashes on Fabric without this:
 * "Exception in HostFunction: PreviewView.previewOutput: Cannot cast dynamic
 * to a jsi::Value type." — RN 0.81.5 defaults useRawPropsJsiValue() to false;
 * vision-camera's native view manager requires it enabled. Breaks Avatar Room
 * (FaceTracker's camera preview) entirely without this override.
 *
 * Extends the same Stable-profile class DefaultNewArchitectureEntryPoint.load()
 * would otherwise construct internally (fabric/turboModules/bridgeless all on,
 * matching this app's actual config) — ReactNativeFeatureFlags.override() can
 * only be called once per process, so we must be the one to call it (via
 * loadWithFeatureFlags) rather than letting load() call it a second time.
 */
class AppFeatureFlags : ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android(
  fabricEnabled = true,
  bridgelessEnabled = true,
  turboModulesEnabled = true,
) {
  override fun useRawPropsJsiValue(): Boolean = true
}
