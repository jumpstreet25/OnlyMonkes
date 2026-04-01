# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# JNA (Java Native Access) — used by XMTP for native bindings.
# Keep all classes and suppress warnings about missing desktop Java (java.awt.*).
-keep class com.sun.jna.** { *; }
-keep interface com.sun.jna.** { *; }
-dontwarn java.awt.**
-dontwarn com.sun.jna.**

# Protocol Buffers — R8 renames fields that protobuf looks up by name at runtime
# (FieldBytes_ / FieldName_ lookups break without this)
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite {
    <fields>;
}
-keepclassmembers class * extends com.google.protobuf.GeneratedMessage {
    <fields>;
}
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# XMTP / UniFfi JNI bindings — use reflection and JNI field lookup internally
-keep class uniffi.** { *; }
-keep class org.xmtp.** { *; }
-keep class xmtpv3.** { *; }
-dontwarn uniffi.**
-dontwarn org.xmtp.**

# expo-gl — view classes are instantiated via reflection by Expo's view manager.
# R8 obfuscates constructors that are only called reflectively, causing
# "Didn't find a correct constructor" crash.
-keep class expo.modules.gl.** { *; }
-keep class expo.modules.gl.GLView { *; }

# expo-three / Three.js support
-keep class expo.modules.** { *; }
-dontwarn expo.modules.**

# react-native-webview
-keep class com.reactnativecommunity.webview.** { *; }
-dontwarn com.reactnativecommunity.webview.**

# javax.lang.model — annotation processor classes referenced by AutoValue/JavaPoet
# (pulled in transitively by react-native-mediapipe or livekit dependencies)
-dontwarn javax.lang.model.SourceVersion
-dontwarn javax.lang.model.element.Element
-dontwarn javax.lang.model.element.ElementKind
-dontwarn javax.lang.model.type.TypeMirror
-dontwarn javax.lang.model.type.TypeVisitor
-dontwarn javax.lang.model.util.SimpleTypeVisitor8

# React Native feature flags — JNI native lib loaded at startup
-keep class com.facebook.react.internal.featureflags.** { *; }
-keep class com.facebook.react.defaults.** { *; }

# Add any project specific keep options here:
