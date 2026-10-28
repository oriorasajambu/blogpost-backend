import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins { kotlin("jvm") version "2.4.0" }

kotlin {
    jvmToolchain(17)
    compilerOptions { jvmTarget.set(JvmTarget.JVM_11) }
    sourceSets.main {
        kotlin.srcDirs(
            "../../../contracts/generated/kotlin/src/main/kotlin",
            "../../../contracts/consumers/kotlin/src/main/kotlin",
        )
    }
}
java { sourceCompatibility = JavaVersion.VERSION_11; targetCompatibility = JavaVersion.VERSION_11 }
sourceSets.main { resources.srcDir("../../../contracts/generated/kotlin/src/main/resources") }
layout.buildDirectory.set(layout.projectDirectory.dir("../../../.local/kotlin-consumer-build"))
dependencyLocking { lockAllConfigurations() }

dependencies {
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-gson:3.0.0")
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    implementation("com.google.code.gson:gson:2.14.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    testImplementation("junit:junit:4.13.2")
}
tasks.test {
    useJUnit()
    maxHeapSize = "256m"
    maxParallelForks = 1
    systemProperty("blogpost.root", rootDir.resolve("../../..").canonicalPath)
    inputs.files(fileTree("../../../contracts/fixtures")).withPropertyName("canonicalFixtures")
    inputs.file("../../../contracts/openapi-v1.json").withPropertyName("canonicalOpenApi")
    inputs.file("../../../contracts/generated/kotlin/generation.json").withPropertyName("generationProvenance")
    inputs.file("../../../tools/kotlin/toolchain.json").withPropertyName("pinnedToolchain")
    testLogging { events("passed", "failed", "skipped") }
}
