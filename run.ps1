# Get the absolute directory path where this script is located
$SystemDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SystemDir

# Verify the virtual environment python interpreter exists
$VenvPython = Join-Path $SystemDir "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Error "Error: Virtual environment python not found at $VenvPython."
    Write-Host "Please configure the venv under 'venv'."
    Exit 1
}

Write-Host "============================================="
Write-Host " Starting CERES Dashboard Server"
Write-Host "============================================="
Write-Host "System directory: $SystemDir"
Write-Host "Python virtual env: $VenvPython"
Write-Host "============================================="

# Detect the best available browser in priority order: Chrome, Firefox, Edge, Brave, Opera
$Browsers = @(
    @{ Name = "Chrome"; Exec = "chrome.exe"; Paths = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )},
    @{ Name = "Firefox"; Exec = "firefox.exe"; Paths = @(
        "C:\Program Files\Mozilla Firefox\firefox.exe",
        "C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
        "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe"
    )},
    @{ Name = "Edge"; Exec = "msedge.exe"; Paths = @(
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    )},
    @{ Name = "Brave"; Exec = "brave.exe"; Paths = @(
        "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
    )},
    @{ Name = "Opera"; Exec = "opera.exe"; Paths = @(
        "C:\Program Files\Opera\launcher.exe",
        "C:\Program Files (x86)\Opera\launcher.exe",
        "$env:LOCALAPPDATA\Programs\Opera\launcher.exe",
        "C:\Program Files\Opera\opera.exe",
        "C:\Program Files (x86)\Opera\opera.exe"
    )}
)

$SelectedBrowserPath = $null
$SelectedBrowserName = $null

foreach ($B in $Browsers) {
    foreach ($P in $B.Paths) {
        if (Test-Path $P) {
            $SelectedBrowserPath = $P
            $SelectedBrowserName = $B.Name
            break
        }
    }
    if ($SelectedBrowserPath) { break }

    $Cmd = Get-Command $B.Exec -ErrorAction SilentlyContinue
    if ($Cmd) {
        $SelectedBrowserPath = $Cmd.Source
        $SelectedBrowserName = $B.Name
        break
    }
}

if (-not $SelectedBrowserPath) {
    # If no browser is found, default to start the system default browser/URL handler
    $SelectedBrowserPath = "explorer.exe"
    $SelectedBrowserName = "SystemDefault"
}

Write-Host "Detected Browser: $SelectedBrowserName ($SelectedBrowserPath)"
Write-Host "============================================="

# Asynchronously launch the browser in fullscreen once the server starts
Start-Job -ScriptBlock {
    param($path, $name)
    Start-Sleep -Seconds 2
    if ($name -eq "SystemDefault") {
        Start-Process "http://localhost:5002"
    } elseif ($name -eq "Firefox") {
        Start-Process $path -ArgumentList "-new-window", "http://localhost:5002"
    } else {
        # Chromium-based browsers (Chrome, Edge, Brave, Opera)
        Start-Process $path -ArgumentList "--new-window", "--start-fullscreen", "http://localhost:5002"
    }
} -ArgumentList $SelectedBrowserPath, $SelectedBrowserName | Out-Null

# Execute the backend app
& $VenvPython backend/app.py $args
