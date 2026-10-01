param(
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [string]$SigningDirectory = (Join-Path $PSScriptRoot '../../../work/private/android-signing')
)
$ErrorActionPreference = 'Stop'
$signingRoot = [IO.Path]::GetFullPath($SigningDirectory)
$keytool = Join-Path $JavaHome 'bin/keytool.exe'
if (!(Test-Path -LiteralPath $keytool)) { throw 'Java keytool is missing' }
New-Item -ItemType Directory -Force -Path $signingRoot | Out-Null
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $signingRoot /inheritance:r /grant:r ('*' + $ownerSid + ':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict signing directory permissions' }
$settingsPath = Join-Path $signingRoot 'signing.private.json'
$keystorePath = Join-Path $signingRoot 'family-learning-release.p12'
$settingsExists = Test-Path -LiteralPath $settingsPath
$keyExists = Test-Path -LiteralPath $keystorePath
if ($settingsExists -ne $keyExists) { throw 'Signing files are incomplete. Restore the existing key; never replace it automatically.' }
$previousPassword = $env:FAMILY_ANDROID_STORE_PASSWORD
try {
    if ($settingsExists) {
        $signing = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
    } else {
        $random = [byte[]]::new(48)
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generator.GetBytes($random) } finally { $generator.Dispose() }
        $signing = @{ keyAlias='family-learning'; storePassword=[Convert]::ToBase64String($random); keyFile='family-learning-release.p12' }
    }
    $env:FAMILY_ANDROID_STORE_PASSWORD = $signing.storePassword
    if (!$keyExists) {
        & $keytool -genkeypair -keystore $keystorePath -storetype PKCS12 -alias $signing.keyAlias -storepass:env FAMILY_ANDROID_STORE_PASSWORD -keypass:env FAMILY_ANDROID_STORE_PASSWORD -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Family Learning, O=Private Family, C=CN' -noprompt
        if ($LASTEXITCODE -ne 0) { throw 'Signing key creation failed' }
        $signing | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding utf8NoBOM
    }
    $certificate = Join-Path $signingRoot 'signer-public.der'
    & $keytool -exportcert -keystore $keystorePath -storetype PKCS12 -alias $signing.keyAlias -storepass:env FAMILY_ANDROID_STORE_PASSWORD -file $certificate
    if ($LASTEXITCODE -ne 0) { throw 'Signing key verification failed' }
    @{ purpose='Persistent Family Learning Android release signing'; certificateSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $certificate).Hash; keyAlias=$signing.keyAlias } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $signingRoot 'signer-public.json') -Encoding utf8NoBOM
    Write-Output 'Persistent signing key is ready. Private material was not printed.'
} finally {
    $env:FAMILY_ANDROID_STORE_PASSWORD = $previousPassword
}
