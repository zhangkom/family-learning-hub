param(
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [Parameter(Mandatory=$true)][string]$AndroidSdk,
    [string]$GradleCommand = (Join-Path $PSScriptRoot '../android/gradlew.bat'),
    [string]$SigningDirectory = (Join-Path $PSScriptRoot '../../../work/private/android-signing'),
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$clientRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectRoot = [IO.Path]::GetFullPath((Join-Path $clientRoot '../..'))
$signingRoot = [IO.Path]::GetFullPath($SigningDirectory)
$signing = Get-Content -Raw -LiteralPath (Join-Path $signingRoot 'signing.private.json') | ConvertFrom-Json
$metadata = Get-Content -Raw -LiteralPath (Join-Path $clientRoot 'package.json') | ConvertFrom-Json
$commit = (& git -C $projectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not identify source commit' }
if (& git -C $projectRoot status --porcelain) { throw 'Commit source changes before making a deliverable APK' }
$names = @('JAVA_HOME','ANDROID_HOME','GRADLE_USER_HOME','JAVA_TOOL_OPTIONS','VITE_API_URL','FAMILY_ANDROID_KEYSTORE','FAMILY_ANDROID_STORE_PASSWORD','FAMILY_ANDROID_KEY_ALIAS')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location $clientRoot
try {
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $AndroidSdk
    $env:GRADLE_USER_HOME = Join-Path $projectRoot 'work/gradle'
    # This Windows JDK falls back to TCP pipes when no Unix-domain temp directory exists.
    $env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=' + (Join-Path $env:TEMP ('family-learning-tcp-' + [guid]::NewGuid().ToString('N'))).Replace('\','/')
    $env:VITE_API_URL = 'https://123.207.232.151/family-learning/api/mobile/v1'
    $env:FAMILY_ANDROID_KEYSTORE = Join-Path $signingRoot $signing.keyFile
    $env:FAMILY_ANDROID_STORE_PASSWORD = $signing.storePassword
    $env:FAMILY_ANDROID_KEY_ALIAS = $signing.keyAlias
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Client build/sync failed' }
    $gradleArgs = @('-p', 'android', ':app:assembleRelease', '--no-daemon', '--console=plain')
    if ($Offline) { $gradleArgs += '--offline' }
    & $GradleCommand @gradleArgs
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
    $apk = Join-Path $clientRoot 'android/app/build/outputs/apk/release/app-release.apk'
    $apksigner = Join-Path $AndroidSdk 'build-tools/36.0.0/apksigner.bat'
    $signature = & $apksigner verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    $fingerprint = (Get-Content -Raw -LiteralPath (Join-Path $signingRoot 'signer-public.json') | ConvertFrom-Json).certificateSha256.ToLowerInvariant()
    if (!(($signature -join "`n").Contains($fingerprint))) { throw 'APK is signed with an unexpected certificate' }
    $aapt = Join-Path $AndroidSdk 'build-tools/36.0.0/aapt.exe'
    if (!(Test-Path -LiteralPath $aapt)) { $aapt = Join-Path $AndroidSdk 'build-tools/36.0.0/aapt' }
    $permissionAudit = & node (Join-Path $PSScriptRoot 'audit-apk-permissions.mjs') $aapt $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK permission audit failed; do not publish' }
    $permissionAudit = $permissionAudit | ConvertFrom-Json
    $output = Join-Path $projectRoot 'outputs/android'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $destination = Join-Path $output ('family-learning-' + $metadata.version + '-release.apk')
    if (Test-Path -LiteralPath $destination) {
        if ((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $apk).Hash) { throw 'An APK already exists for this version; increment the version before replacing it' }
    } else { Copy-Item -LiteralPath $apk -Destination $destination }
    $verification = @{ file=$destination; version=$metadata.version; versionCode=$metadata.androidVersionCode; commit=$commit; kind='family-pilot-release'; bytes=(Get-Item -LiteralPath $destination).Length; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash; certificateSha256=$fingerprint; signatureVerified=$true; nativeDeviceTested=$false; apiBase=$env:VITE_API_URL }
    $verification.permissions = $permissionAudit.permissions
    $verification.permissionsVerified = $permissionAudit.permissionsVerified
    $verification | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output ('apk-verification-' + $metadata.version + '.json')) -Encoding utf8NoBOM
    $verification | Select-Object version,versionCode,commit,bytes,sha256,certificateSha256,signatureVerified,nativeDeviceTested | ConvertTo-Json
} finally {
    Pop-Location
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
