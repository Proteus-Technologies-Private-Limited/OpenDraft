plugins {
    id("com.android.library") version "8.9.1"
    // Match the compiler in Tauri's Android project template.
    id("org.jetbrains.kotlin.android") version "1.9.25"
}

android {
    namespace = "com.proteus.opendraft"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
    sourceSets["main"].java.srcDir("../../src-tauri/android-src")
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
    testOptions.unitTests.isIncludeAndroidResources = true
}
dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.lifecycle:lifecycle-common:2.8.7")
    // Keep identical to android_fold_build.py: this is the release dependency.
    implementation("androidx.window:window-java:1.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
tasks.withType<Test>().configureEach {
    maxParallelForks = 1
    maxHeapSize = "1g"
    jvmArgs("-XX:ActiveProcessorCount=2")
}
