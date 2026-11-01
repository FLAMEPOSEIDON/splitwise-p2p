-keepattributes *Annotation*
-keepattributes JavascriptInterface

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.splitwise.p2p.** { *; }
