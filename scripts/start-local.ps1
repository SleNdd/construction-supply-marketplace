param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$siteUrl = 'http://localhost:3000'

function Test-DockerReady {
    $probe = New-Object Diagnostics.Process
    try {
        $probe.StartInfo.FileName = (Get-Command docker.exe).Source
        $probe.StartInfo.Arguments = 'info --format {{.OSType}}'
        $probe.StartInfo.UseShellExecute = $false
        $probe.StartInfo.CreateNoWindow = $true
        $probe.StartInfo.RedirectStandardOutput = $true
        $probe.StartInfo.RedirectStandardError = $true
        $null = $probe.Start()
        $output = $probe.StandardOutput.ReadToEndAsync()
        $errorOutput = $probe.StandardError.ReadToEndAsync()
        if (-not $probe.WaitForExit(8000)) { $probe.Kill(); return $false }
        return ($probe.ExitCode -eq 0 -and $output.GetAwaiter().GetResult().Trim() -eq 'linux')
    } finally { $probe.Dispose() }
}

try {
    if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
        throw 'Install Docker Desktop, then run this file again.'
    }
    # Первый запуск создаёт отдельный пароль локальной базы.
    $envFile = Join-Path $projectRoot '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        $randomBytes = New-Object byte[] 24
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
        $dbPassword = [Convert]::ToBase64String($randomBytes).Replace('+','A').Replace('/','B').TrimEnd('=')
        $settings = [IO.File]::ReadAllText((Join-Path $projectRoot '.env.example'))
        $settings = [regex]::Replace($settings, '(?m)^POSTGRES_PASSWORD=.*$', ('POSTGRES_PASSWORD=' + $dbPassword))
        [IO.File]::WriteAllText($envFile, $settings, (New-Object Text.UTF8Encoding($false)))
    }
    if (-not (Test-DockerReady)) {
        $desktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (-not (Test-Path -LiteralPath $desktopExe)) { throw 'Start Docker Desktop and run this file again.' }
        Start-Process -FilePath $desktopExe -WindowStyle Hidden | Out-Null
        $deadline = [DateTime]::UtcNow.AddMinutes(4)
        do {
            Start-Sleep -Seconds 3
            $ready = Test-DockerReady
        } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
        if (-not $ready) { throw 'Docker Desktop did not start. Check its status and retry.' }
    }
    Push-Location $projectRoot
    try {
        & docker compose --project-name stroypotok --env-file $envFile up --build -d --wait --wait-timeout 180
        if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Check Docker and the messages above.' }
    } finally { Pop-Location }
    Write-Host $siteUrl -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process $siteUrl | Out-Null }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
