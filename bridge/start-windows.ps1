[CmdletBinding()]
param(
    [switch]$QuickTunnel,
    [string]$PublicBase,
    [int]$Port = 3147
)
$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'NuvioAbyssBridge'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$serverPath = Join-Path $PSScriptRoot 'server.js'
if (-not (Test-Path -LiteralPath $serverPath)) { throw 'server.js tidak ditemui. Extract keseluruhan ZIP repo dahulu.' }
if (-not $QuickTunnel -and $PublicBase -notmatch '^https://[^\s?#]+$') { throw 'Gunakan -QuickTunnel untuk ujian, atau -PublicBase https://domain-bridge-anda.' }

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeExe = $nodeCommand.Source }
else {
    $releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $release = $releases | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1
    if (-not $release) { throw 'Node.js 22 LTS tidak ditemui.' }
    $archiveName = 'node-' + $release.version + '-win-x64.zip'
    $nodeFolder = Join-Path $installRoot ('node-' + $release.version + '-win-x64')
    $nodeExe = Join-Path $nodeFolder 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) {
        $downloadBase = 'https://nodejs.org/dist/' + $release.version + '/'
        $archivePath = Join-Path $installRoot $archiveName
        Invoke-WebRequest ($downloadBase + $archiveName) -OutFile $archivePath -UseBasicParsing
        $checksums = (Invoke-WebRequest ($downloadBase + 'SHASUMS256.txt') -UseBasicParsing).Content
        $match = [regex]::Match($checksums, '(?m)^([a-f0-9]{64})\s+' + [regex]::Escape($archiveName) + '\r?$')
        if (-not $match.Success -or (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $match.Groups[1].Value) { throw 'Semakan SHA256 Node.js gagal.' }
        Expand-Archive -LiteralPath $archivePath -DestinationPath $installRoot -Force
    }
}
$nodeVersion = & $nodeExe -p 'parseInt(process.versions.node)'
if ([int]$nodeVersion -lt 18) { throw 'Perlukan Node.js 18 atau lebih baharu.' }
try { $existingHealth = Invoke-RestMethod ('http://127.0.0.1:' + $Port + '/health') -TimeoutSec 2 }
catch { $existingHealth = $null }
if ($existingHealth) { throw 'Bridge sudah berjalan pada port ini. Gunakan konfigurasi sedia ada atau hentikan proses bridge yang lama dahulu.' }

$tunnelProcess = $null
try {
    if ($QuickTunnel) {
        $release = Invoke-RestMethod 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
        $asset = $release.assets | Where-Object { $_.name -eq 'cloudflared-windows-amd64.exe' } | Select-Object -First 1
        if (-not $asset -or $asset.digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Fail cloudflared dengan digest rasmi tidak ditemui.' }
        $cloudflaredExe = Join-Path $installRoot 'cloudflared.exe'
        if (-not (Test-Path -LiteralPath $cloudflaredExe) -or (Get-FileHash -LiteralPath $cloudflaredExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.digest.Substring(7)) {
            Invoke-WebRequest $asset.browser_download_url -OutFile $cloudflaredExe -UseBasicParsing
        }
        if ((Get-FileHash -LiteralPath $cloudflaredExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.digest.Substring(7)) { throw 'Semakan SHA256 cloudflared gagal.' }
        $logPath = Join-Path $installRoot ('tunnel-' + [guid]::NewGuid().ToString('N') + '.log')
        $tunnelArgs = 'tunnel --no-autoupdate --url http://127.0.0.1:' + $Port + ' --logfile "' + $logPath + '"'
        $tunnelProcess = Start-Process -FilePath $cloudflaredExe -ArgumentList $tunnelArgs -WindowStyle Hidden -PassThru
        for ($attempt = 0; $attempt -lt 45; $attempt++) {
            Start-Sleep -Seconds 1
            if (Test-Path -LiteralPath $logPath) {
                $log = Get-Content -LiteralPath $logPath -Raw
                $match = [regex]::Match($log, 'https://[a-z0-9-]+\.trycloudflare\.com')
                if ($match.Success) { $PublicBase = $match.Value; break }
            }
            if ($tunnelProcess.HasExited) { throw 'Cloudflare Tunnel berhenti. Semak log di folder NuvioAbyssBridge.' }
        }
        if (-not $PublicBase) { throw 'URL tunnel belum diterima. Cuba semula selepas semak sambungan Internet VPS.' }
    }
    $secretBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
    $token = [Convert]::ToBase64String($secretBytes)
    $env:ABYSS_BRIDGE_TOKEN = $token
    $env:ABYSS_PUBLIC_BASE = $PublicBase.TrimEnd('/')
    $env:ABYSS_HOST = '127.0.0.1'
    $env:ABYSS_PORT = [string]$Port
    $bridgeProcess = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $serverPath + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $installRoot 'bridge-output.log') -RedirectStandardError (Join-Path $installRoot 'bridge-error.log')
    $healthy = $false
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod ('http://127.0.0.1:' + $Port + '/health') -TimeoutSec 2; if ($health.ok) { $healthy = $true; break } } catch {}
    }
    if (-not $healthy) { throw 'Bridge gagal bermula. Semak bridge-error.log.' }
    # Store the token with Windows user-bound encryption, outside the Git repository.
    $protected = ConvertFrom-SecureString (ConvertTo-SecureString $token -AsPlainText -Force)
    @{url=$PublicBase;tokenProtected=$protected;bridgePid=$bridgeProcess.Id;tunnelPid=$(if ($tunnelProcess) {$tunnelProcess.Id} else {$null})} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'session.json') -Encoding UTF8
    Write-Host ('Abyss bridge URL: ' + $PublicBase)
    Write-Host ('Abyss bridge token: ' + $token)
    Write-Host 'Salin dua nilai ini ke tetapan provider Nuvio, kemudian pilih Server Abyss.'
    if ($QuickTunnel) { Write-Host 'Quick Tunnel hanya untuk ujian: URL berubah selepas restart. Ia bukan pemasangan kekal.' }
} catch {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id }
    throw
} finally {
    Remove-Item Env:ABYSS_BRIDGE_TOKEN -ErrorAction SilentlyContinue
}
