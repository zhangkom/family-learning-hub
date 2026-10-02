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
    (Join-Path $clientRoot 'android/app/src/main/java/cn/familylearning/study/PhotoBatchStore.java'),
    (Join-Path $clientRoot 'android/app/src/main/java/cn/familylearning/study/CloudOriginalDownload.java'),
    (Join-Path $PSScriptRoot 'java/cn/familylearning/study/PhotoBatchTransportTest.java')
)
& (Join-Path $JavaHome 'bin/javac.exe') --add-modules jdk.httpserver -encoding UTF-8 -d $classes @javaSources
if ($LASTEXITCODE -ne 0) { throw 'Batch transport Java compilation failed' }
$tcpFallback = '-Djdk.net.unixdomain.tmpdir=' + (Join-Path $artifactRoot ('unused-pipe-' + [guid]::NewGuid().ToString('N'))).Replace('\','/')
$result = & (Join-Path $JavaHome 'bin/java.exe') $tcpFallback --add-modules jdk.httpserver -cp $classes cn.familylearning.study.PhotoBatchTransportTest $artifactRoot
if ($LASTEXITCODE -ne 0) { throw 'Batch transport verification failed' }
$result | Set-Content -LiteralPath (Join-Path $artifactRoot 'java-batch-result.txt') -Encoding utf8
$result
