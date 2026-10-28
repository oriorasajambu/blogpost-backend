# Preserve Retrofit's coroutine generic signatures and the custom operation annotation.
-keepattributes Signature,RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault,InnerClasses,EnclosingMethod
-keep @interface com.blogpost.contract.wire.WireOperation { *; }
# Gson reflects on these DTOs and enum annotations; preserve their package for factory scoping.
-keep class com.blogpost.contract.generated.** { *; }
-keep interface com.blogpost.contract.generated.api.** { *; }
