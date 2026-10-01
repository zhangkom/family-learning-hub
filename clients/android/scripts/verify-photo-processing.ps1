param(
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$clientRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactRoot = [IO.Path]::GetFullPath($OutputDirectory)
$classes = Join-Path $artifactRoot 'classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$javaSources = @(
    (Join-Path $clientRoot 'android/app/src/main/java/cn/familylearning/study/PhotoGeometry.java'),
    (Join-Path $clientRoot 'android/app/src/main/java/cn/familylearning/study/PhotoLight.java'),
    (Join-Path $PSScriptRoot 'java/cn/familylearning/study/PhotoProcessingCoreTest.java')
)
& (Join-Path $JavaHome 'bin/javac.exe') -d $classes @javaSources
if ($LASTEXITCODE -ne 0) { throw 'Photo processing Java compilation failed' }
$result = & (Join-Path $JavaHome 'bin/java.exe') -cp $classes cn.familylearning.study.PhotoProcessingCoreTest $artifactRoot
if ($LASTEXITCODE -ne 0) { throw 'Photo processing core verification failed' }
$result | Set-Content -LiteralPath (Join-Path $artifactRoot 'java-core-result.txt') -Encoding utf8
$result
