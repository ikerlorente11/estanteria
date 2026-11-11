# Rules for the release build (R8) of the apps that use this module.

# Optional classes that some libraries name but do not need (annotations of Tink, used by
# androidx.security for the saved credentials, and slf4j's binder): nothing to keep, nothing to warn.
-dontwarn com.google.errorprone.annotations.**
-dontwarn org.slf4j.**
-dontwarn javax.annotation.**
-dontwarn org.brotli.dec.**
-dontwarn com.github.luben.zstd.**
-dontwarn org.objectweb.asm.**

# Called from native code (JNI): their names and members must stay as they are.
# libarchive (RAR5, 7z), jxl-coder (JPEG XL).
-keep class me.zhanghai.android.libarchive.** { *; }
-keep class com.awxkee.jxlcoder.** { *; }

# Found by reflection: junrar's and commons-compress' own classes, and NanoHTTPD's.
-keep class com.github.junrar.** { *; }
-keep class org.apache.commons.compress.** { *; }
-keep class org.tukaani.xz.** { *; }
-keep class fi.iki.elonen.** { *; }
