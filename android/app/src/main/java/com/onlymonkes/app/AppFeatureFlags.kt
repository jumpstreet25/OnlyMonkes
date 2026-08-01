package com.onlymonkes.app

import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults

/**
 * react-native-vision-camera 5's PreviewView crashes on Fabric without this:
 * "Exception in HostFunction: PreviewView.previewOutput: Cannot cast dynamic
 * to a jsi::Value type." — RN 0.81.5 defaults useRawPropsJsiValue() to false;
 * vision-camera's native view manager requires it enabled. Breaks Avatar Room
 * (FaceTracker's camera preview) entirely without this override.
 */
class AppFeatureFlags : ReactNativeFeatureFlagsDefaults() {
  override fun useRawPropsJsiValue(): Boolean = true
}
