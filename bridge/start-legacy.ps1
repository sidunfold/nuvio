[CmdletBinding()]
param(
    [switch]$QuickTunnel,
    [switch]$LocalOnly,
    [switch]$Stop,
    [string]$PublicBase,
    [int]$Port = 3147,
    [switch]$Run
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$sourcePath = Join-Path $PSScriptRoot 'legacy\AbyssBridge.cs'
if (-not (Test-Path -LiteralPath $sourcePath)) { throw 'Extract keseluruhan ZIP baharu: bridge\legacy\AbyssBridge.cs tidak ditemui.' }

if ($Run) {
    Add-Type -Path $sourcePath -ReferencedAssemblies System.dll,System.Core.dll,System.Web.dll,System.Web.Extensions.dll
    $service = New-Object NuvioLegacy.AbyssBridge($env:ABYSS_PUBLIC_BASE, $env:ABYSS_BRIDGE_TOKEN)
    Write-Output ('Legacy bridge listening on 127.0.0.1:' + $Port)
    $service.Run($Port)
    exit
}

$installRoot = Join-Path $env:LOCALAPPDATA 'NuvioAbyssLegacy'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
if ($Stop) {
    $sessionPath = Join-Path $installRoot 'session.json'
    if (-not (Test-Path -LiteralPath $sessionPath)) { Write-Host 'Tiada sesi bridge tersimpan.'; return }
    $session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
    foreach ($processInfo in @(@{id=$session.bridgePid;exe=(Join-Path $installRoot 'NuvioAbyssLegacy.exe')}, @{id=$session.tunnelPid;exe=(Join-Path $installRoot 'cloudflared-2023.8.2.exe')})) {
        if ($processInfo.id) {
            $ownedProcess = Get-Process -Id $processInfo.id -ErrorAction SilentlyContinue
            if ($ownedProcess -and $ownedProcess.Path -eq $processInfo.exe) { Stop-Process -Id $ownedProcess.Id }
        }
    }
    Write-Host 'Proses bridge/tunnel yang sepadan dengan sesi telah dihentikan.'
    return
}
if ($LocalOnly -and $QuickTunnel) { throw 'Pilih -LocalOnly atau -QuickTunnel, bukan kedua-duanya.' }
if ($LocalOnly) { $PublicBase = 'http://127.0.0.1:' + $Port }
if (-not $LocalOnly -and -not $QuickTunnel -and $PublicBase -notmatch '^https://[^\s?#]+$') { throw 'Gunakan -LocalOnly untuk uji VPS, -QuickTunnel untuk cubaan tunnel, atau -PublicBase https://domain-bridge-anda.' }
try { $existingHealth = Invoke-RestMethod ('http://127.0.0.1:' + $Port + '/health') -TimeoutSec 2 } catch { $existingHealth = $null }
if ($existingHealth) { throw 'Bridge sudah berjalan pada port ini. Gunakan konfigurasi sedia ada; jangan jalankan dua bridge pada port yang sama.' }

$tunnelProcess = $null
$bridgeProcess = $null
$previousToken = $env:ABYSS_BRIDGE_TOKEN
$previousBase = $env:ABYSS_PUBLIC_BASE
try {
    if ($QuickTunnel) {
        # Official release built with Go 1.20, before Go dropped Windows 2012 R2.
        # Temporary compatibility test only; an existing HTTPS reverse proxy is preferred.
        $tunnelVersion = '2023.8.2'
        $expectedHash = '0409c9b12f9d0eda86e461ed9bdabeefb00172b26322079681a0bdf48e68dc28'
        $cloudflaredExe = Join-Path $installRoot ('cloudflared-' + $tunnelVersion + '.exe')
        if (-not (Test-Path -LiteralPath $cloudflaredExe) -or (Get-FileHash -LiteralPath $cloudflaredExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
            Invoke-WebRequest ('https://github.com/cloudflare/cloudflared/releases/download/' + $tunnelVersion + '/cloudflared-windows-amd64.exe') -OutFile $cloudflaredExe -UseBasicParsing
        }
        if ((Get-FileHash -LiteralPath $cloudflaredExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'SHA256 cloudflared tidak sepadan dengan release rasmi.' }
        Write-Warning 'Quick Tunnel menggunakan release lama yang serasi dengan Windows ini. Ia untuk ujian sementara dan mungkin ditolak oleh Cloudflare. Untuk kekal, gunakan reverse proxy HTTPS.'
        $logPath = Join-Path $installRoot ('tunnel-' + [guid]::NewGuid().ToString('N') + '.log')
        $arguments = 'tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:' + $Port + ' --logfile "' + $logPath + '"'
        $tunnelProcess = Start-Process -FilePath $cloudflaredExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
        for ($attempt = 0; $attempt -lt 45; $attempt++) {
            Start-Sleep -Seconds 1
            if (Test-Path -LiteralPath $logPath) {
                $match = [regex]::Match((Get-Content -LiteralPath $logPath -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
                if ($match.Success) { $PublicBase = $match.Value; break }
            }
            if ($tunnelProcess.HasExited) { throw 'Tunnel berhenti. Semak log dalam folder NuvioAbyssLegacy; gunakan reverse proxy HTTPS jika release lama ditolak.' }
        }
        if (-not $PublicBase) { throw 'Tunnel tidak memberikan URL. Bridge belum diaktifkan; semak log atau gunakan -PublicBase dengan reverse proxy HTTPS.' }
    }
    $randomBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
    $token = [Convert]::ToBase64String($randomBytes)
    $env:ABYSS_BRIDGE_TOKEN = $token
    $env:ABYSS_PUBLIC_BASE = $PublicBase.TrimEnd('/')
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compiler .NET Framework tidak ditemui.' }
    $bridgeExe = Join-Path $installRoot 'NuvioAbyssLegacy.exe'
    $writeProbe = Join-Path $installRoot ('write-check-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try { [IO.File]::WriteAllText($writeProbe, 'ok') } catch { throw ('Folder bridge tidak boleh ditulis: ' + $installRoot + '. ' + $_.Exception.Message) }
    finally { if (Test-Path -LiteralPath $writeProbe) { Remove-Item -LiteralPath $writeProbe } }
    # Use an explicit working directory and relative output for legacy PowerShell/CSC.
    $compilerOutput = Join-Path $installRoot 'compiler-output.log'
    $compilerError = Join-Path $installRoot 'compiler-error.log'
    $compilerArguments = '/nologo /target:exe /langversion:5 /out:NuvioAbyssLegacy.exe /reference:System.Web.dll /reference:System.Web.Extensions.dll "' + $sourcePath + '"'
    $previousTemp = $env:TEMP
    $previousTmp = $env:TMP
    try {
        # Disconnected RDP sessions can leave TEMP/TMP pointing at missing folders.
        $env:TEMP = $installRoot
        $env:TMP = $installRoot
        $compileProcess = Start-Process -FilePath $compiler -WorkingDirectory $installRoot -ArgumentList $compilerArguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $compilerOutput -RedirectStandardError $compilerError
    } finally { $env:TEMP = $previousTemp; $env:TMP = $previousTmp }
    if ($compileProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $bridgeExe)) {
        foreach ($compilerLog in @($compilerOutput, $compilerError)) { if (Test-Path -LiteralPath $compilerLog) { Get-Content -LiteralPath $compilerLog -Tail 20 | Write-Host } }
        throw ('Bridge .NET gagal dikompilasi. Log: ' + $installRoot)
    }
    $bridgeProcess = Start-Process -FilePath $bridgeExe -ArgumentList ([string]$Port) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $installRoot 'bridge-output.log') -RedirectStandardError (Join-Path $installRoot 'bridge-error.log')
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod ('http://127.0.0.1:' + $Port + '/health') -TimeoutSec 2; if ($health.ok) { $healthy = $true; break } } catch {}
        if ($bridgeProcess.HasExited) { break }
    }
    if (-not $healthy) { throw 'Bridge .NET gagal bermula. Lihat %LOCALAPPDATA%\NuvioAbyssLegacy\bridge-error.log.' }
    if ($QuickTunnel) {
        $publicHealthy = $false
        $checkUntil = [DateTime]::UtcNow.AddSeconds(60)
        Write-Host 'Menyemak akses HTTPS awam...'
        while ([DateTime]::UtcNow -lt $checkUntil) {
            try { $publicHealth = Invoke-RestMethod ($PublicBase + '/health') -TimeoutSec 5; if ($publicHealth.ok -and $publicHealth.service -eq 'nuvio-abyss-bridge') { $publicHealthy = $true; break } } catch {}
            Start-Sleep -Seconds 2
        }
        if (-not $publicHealthy) { throw 'Bridge .NET boleh berjalan, tetapi URL tunnel tidak dapat dicapai. Release tunnel lama mungkin tidak lagi berfungsi pada rangkaian ini. Gunakan -PublicBase dengan reverse proxy HTTPS daripada hosting; semak folder log NuvioAbyssLegacy.' }
    }
    $protected = ConvertFrom-SecureString (ConvertTo-SecureString $token -AsPlainText -Force)
    @{url=$PublicBase;tokenProtected=$protected;bridgePid=$bridgeProcess.Id;tunnelPid=$(if ($tunnelProcess) {$tunnelProcess.Id} else {$null})} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'session.json') -Encoding UTF8
    if ($LocalOnly) {
        Write-Host 'PASS: bridge .NET berjalan dalam VPS. Port awam/firewall/RDP tidak diubah.'
        Write-Host ('Health tempatan: ' + $PublicBase + '/health')
        try {
            $sourceCheck = Invoke-RestMethod ($PublicBase + '/resolve?v=PAj-fvN1_') -Headers @{Authorization=('Bearer ' + $token)} -TimeoutSec 45
            Write-Host ('Sumber Abyss: ' + (($sourceCheck.streams | ForEach-Object {$_.quality}) -join ', '))
        } catch { Write-Warning 'Bridge hidup tetapi semakan Abyss gagal. Semak sambungan Internet/TLS dan log; main balik belum disahkan.' }
        Write-Host 'Ini ujian tempatan sahaja. Jangan masukkan 127.0.0.1 sebagai URL bridge pada telefon/TV.'
        Write-Host 'Untuk tetapan HTTPS baharu, hentikan sesi ini dahulu menggunakan -Stop.'
    } else {
        Write-Host ('Abyss bridge URL: ' + $PublicBase)
        Write-Host ('Abyss bridge token: ' + $token)
        Write-Host 'Nuvio: Server pilihan = Abyss, kemudian salin URL dan token ini ke tetapan provider.'
    }
    if ($QuickTunnel) { Write-Host 'URL sementara berubah selepas tunnel restart. Proses tidak dimulakan automatik selepas VPS reboot.' }
} catch {
    if ($bridgeProcess -and -not $bridgeProcess.HasExited) { Stop-Process -Id $bridgeProcess.Id }
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id }
    throw
} finally {
    $env:ABYSS_BRIDGE_TOKEN = $previousToken
    $env:ABYSS_PUBLIC_BASE = $previousBase
}
