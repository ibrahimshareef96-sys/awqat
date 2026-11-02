# Release shrinking (R8). Capacitor reads each plugin's permissions and methods from annotations at run time, so the
# annotations, the bridge and the plugins stay whole; the large scanner and camera libraries underneath still shrink.
# Without these, the camera plugin crashed on takePhoto ("getPermissionState(...) must not be null").

-keepattributes *Annotation*,RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault,Signature,InnerClasses,EnclosingMethod

-keep @interface com.getcapacitor.annotation.** { *; }
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.capacitorjs.osinappbrowser.** { *; }
-keep class io.ionic.** { *; }
-keep class com.outsystems.plugins.** { *; }
# The app's own plugins (the widgets' bridge and the live cards'): their methods are found by their annotation too.
-keep class app.awqat.WidgetBridgePlugin { *; }
-keep class app.awqat.LiveBridgePlugin { *; }

# Kotlin metadata used by the Kotlin plugins.
-keep class kotlin.Metadata { *; }
