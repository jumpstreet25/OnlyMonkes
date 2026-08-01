package com.onlymonkes.app

import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults

/**
 * react-native-vision-camera 5's PreviewView crashes on Fabric without this:
 * "Exception in HostFunction: PreviewView.previewOutput: Cannot cast dynamic
 * to a jsi::Value type." — RN 0.81.5 defaults useRawPropsJsiValue() to false;
 * vision-camera's native view manager requires it enabled. Breaks Avatar Room
 * (FaceTracker's camera preview) entirely without this override.
 *
 * Extends ReactNativeNewArchitectureFeatureFlagsDefaults — NOT
 * ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android, which is `final` in
 * Kotlin and cannot be subclassed (confirmed via a real EAS build failure:
 * "This type is final, so it cannot be extended"). This is RN's own
 * documented extension point for exactly this ("meant to be overrode only by
 * internal apps migrating to the new architecture"). Replicates the same 4
 * overrides ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android(true, true,
 * true) would give (this app runs fabric+turboModules+bridgeless all on) —
 * see MainApplication.kt for why loadWithFeatureFlags is invoked via
 * reflection rather than directly.
 */
class AppFeatureFlags : ReactNativeNewArchitectureFeatureFlagsDefaults(true) {
  override fun useFabricInterop(): Boolean = true
  override fun useShadowNodeStateOnClone(): Boolean = true
  override fun useRawPropsJsiValue(): Boolean = true
}
