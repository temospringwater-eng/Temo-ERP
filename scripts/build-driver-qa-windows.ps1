# Build TEMO native Driver QA APK on a Windows laptop without GitHub Actions minutes.
# Requires Android Studio SDK and Windows internet for Gradle/Android dependencies.
# This script does NOT deploy to ERP, edit live data, or change GitHub billing.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$androidProject = Join-Path $repoRoot 'android-driver'
$buildResult = Join-Path $androidProject 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path (Join-Path $androidProject 'app\build.gradle'))) {
    throw 'TEMO Android source missing. Download the whole recovery branch, not only this script.'
}
if (-not $env:LOCALAPPDATA) { throw 'Windows LOCALAPPDATA is missing.' }

$sdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))
$sdk = $null
foreach ($candidate in $sdkCandidates) {
    if ($candidate -and (Test-Path $candidate)) { $sdk = (Resolve-Path $candidate).Path; break }
}
if (-not $sdk) {
    throw 'Android SDK not found. Install Android Studio, then in SDK Manager install Android SDK Platform 35, Build-Tools 35.0.0, and Command-line Tools (latest).'
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

$bundledJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
if (Test-Path (Join-Path $bundledJava 'bin\java.exe')) {
    $env:JAVA_HOME = $bundledJava
    $env:PATH = (Join-Path $bundledJava 'bin') + ';' + $env:PATH
}
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw 'Java not found. Install Android Studio with its bundled JDK or JDK 17+. '
}
& java -version
if ($LASTEXITCODE -ne 0) { throw 'Java cannot run.' }

$platform = Join-Path $sdk 'platforms\android-35\android.jar'
$buildTools = Join-Path $sdk 'build-tools\35.0.0\aapt2.exe'
if (-not (Test-Path $platform) -or -not (Test-Path $buildTools)) {
    $sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
    if (-not (Test-Path $sdkmanager)) {
        throw 'Android SDK components missing. Open Android Studio > SDK Manager > install Android API 35, Build-Tools 35.0.0 and Command-line Tools (latest), then rerun.'
    }
    Write-Host 'Installing Android SDK Platform 35 and Build-Tools 35.0.0...'
    & $sdkmanager "--sdk_root=$sdk" 'platforms;android-35' 'build-tools;35.0.0'
    if ($LASTEXITCODE -ne 0) {
        throw 'Android SDK installation failed. Accept SDK licenses in Android Studio > SDK Manager, then rerun.'
    }
}
if (-not (Test-Path $platform) -or -not (Test-Path $buildTools)) {
    throw 'Android SDK Platform 35 or Build-Tools 35.0.0 still missing.'
}

$toolRoot = Join-Path $env:LOCALAPPDATA 'TEMO-Driver-Tools'
$gradleHome = Join-Path $toolRoot 'gradle-8.9'
$gradleBat = Join-Path $gradleHome 'bin\gradle.bat'
if (-not (Test-Path $gradleBat)) {
    New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
    $zip = Join-Path $toolRoot 'gradle-8.9-bin.zip'
    Write-Host 'Downloading official Gradle 8.9...'
    Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.9-bin.zip' -OutFile $zip -UseBasicParsing
    $expected = 'd725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab'
    $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Remove-Item $zip -Force
        throw 'Official Gradle ZIP checksum mismatch. Build stopped for safety.'
    }
    Expand-Archive -Path $zip -DestinationPath $toolRoot -Force
}
if (-not (Test-Path $gradleBat)) { throw 'Gradle 8.9 installation failed.' }

Write-Host 'Compiling TEMO Driver Native Android QA APK...'
& $gradleBat -p $androidProject ':app:assembleDebug' '--no-daemon'
if ($LASTEXITCODE -ne 0) { throw 'Gradle compile failed; see the error printed above.' }
if (-not (Test-Path $buildResult)) { throw 'APK missing after build.' }

$outputDir = Join-Path $repoRoot 'driver-qa-output'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$outputApk = Join-Path $outputDir 'TEMO-Driver-Native-QA.apk'
Copy-Item -Path $buildResult -Destination $outputApk -Force
$sha = (Get-FileHash -Path $outputApk -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path ($outputApk + '.sha256') -Value ($sha + '  TEMO-Driver-Native-QA.apk') -Encoding ASCII
Write-Host ''
Write-Host 'BUILD SUCCESS: TEMO native driver QA APK ready'
Write-Host "APK: $outputApk"
Write-Host "SHA256: $sha"
Write-Host 'QA ONLY: Debug-signed package. Do not publish to Play Store or use for live cash/customer records.'
