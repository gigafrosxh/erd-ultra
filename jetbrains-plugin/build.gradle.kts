import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "io.github.gigafrosxh"
version = providers.gradleProperty("pluginVersion").get()

// Java 21 = Laufzeit der IDEs ab 2024.3
java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-Xlint:deprecation")
}

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        // Lokal kann mit -PplatformLocalPath=/Pfad/zur/IDE.app gegen eine installierte IDE gebaut werden
        val local = providers.gradleProperty("platformLocalPath").orNull
        if (local != null) local(local)
        else create(IntelliJPlatformType.IntellijIdeaCommunity, providers.gradleProperty("platformVersion"))
        pluginVerifier()
    }
}

intellijPlatform {
    buildSearchableOptions = false
    // ./gradlew verifyPlugin -PverifyIdes=/Applications/PyCharm.app,/Applications/DataGrip.app
    pluginVerification {
        ides {
            providers.gradleProperty("verifyIdes").orNull?.split(",")?.forEach { local(it.trim()) }
                ?: create(IntelliJPlatformType.IntellijIdeaCommunity, providers.gradleProperty("platformVersion"))
        }
    }
    pluginConfiguration {
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = provider { null }
        }
    }
}

// Die React-App (gleiche Quellen wie die Desktop-App) wird ins Plugin gepackt
val buildWebapp by tasks.registering(Exec::class) {
    description = "Baut die ERD-Ultra-Web-App für das Plugin (npm run build:plugin)."
    val repo = layout.projectDirectory.dir("..")
    workingDir = repo.asFile
    val npm = if (System.getProperty("os.name").lowercase().contains("win")) "npm.cmd" else "npm"
    commandLine(npm, "run", "build:plugin")
    inputs.dir(repo.dir("src"))
    inputs.dir(repo.dir("public"))
    inputs.files(repo.file("index.html"), repo.file("package.json"), repo.file("vite.config.ts"), repo.file("tsconfig.json"))
    outputs.dir(layout.buildDirectory.dir("webapp"))
    outputs.cacheIf { true }
}

tasks.processResources {
    from(buildWebapp) {
        into("webapp")
        exclude("__preview/**")
    }
}
// ./gradlew runIde -PopenPath=/pfad/zum/projekt öffnet direkt ein Projekt in der Test-IDE
tasks.runIde {
    providers.gradleProperty("openPath").orNull?.let { args(it) }
    jvmArgumentProviders += CommandLineArgumentProvider {
        listOfNotNull(providers.gradleProperty("jcefDebugPort").orNull?.let { "-Dide.browser.jcef.debug.port=$it" })
    }
}
