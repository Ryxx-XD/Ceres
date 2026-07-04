# ============================================================
#  CERES — Background Shutdown Monitor (with logging)
# ============================================================

$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile     = Join-Path $LauncherDir "monitor.log"
$Url         = "http://localhost:5002/api/fleet"

function Write-Log($Message) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$Timestamp] $Message" | Out-File -FilePath $LogFile -Append -Encoding UTF8
}

# Clear old log file
if (Test-Path $LogFile) { Remove-Item $LogFile -Force }

Write-Log "Monitor started. Polling URL: $Url"

# Function to test if the server is active (HTTP 200)
function Test-ServerActive {
    try {
        $req = [System.Net.WebRequest]::Create($Url)
        $req.Timeout = 1500 # 1.5 seconds timeout
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

# 1. Wait dynamically for the server to become active
$ServerActive = $false
$Attempts = 0
while (-not $ServerActive -and $Attempts -lt 30) {
    Start-Sleep -Seconds 1
    if (Test-ServerActive) {
        $ServerActive = $true
        Write-Log "Server detected as active on attempt $Attempts."
    }
    $Attempts++
}

if (-not $ServerActive) {
    Write-Log "Server failed to start within 30 seconds. Exiting."
    exit
}

# 2. Monitor the server. Exit loop as soon as it goes offline or returns non-200 (503)
Write-Log "Starting active server monitoring..."
while (Test-ServerActive) {
    Start-Sleep -Seconds 1
}
Write-Log "Server is offline or shutting down."

Write-Log "Waiting 1.5 seconds for frontend overlay transition..."
Start-Sleep -Seconds 1.5

# 3. Locate and close browser windows
$TitleFilters = @("*ceres*", "*terminated*")
$BrowserNames = @("msedge", "chrome", "firefox", "opera", "brave")

Write-Log "Querying processes..."
$Processes = Get-Process -Name $BrowserNames -ErrorAction SilentlyContinue
Write-Log "Found $($Processes.Count) total browser processes."
$MatchedProcesses = @()

foreach ($P in $Processes) {
    $Title = $P.MainWindowTitle
    if ($Title) {
        Write-Log "Process ID: $($P.Id) ($($P.Name)) has MainWindowTitle: '$Title'"
        foreach ($F in $TitleFilters) {
            if ($Title -like $F) {
                Write-Log "  -> Matches filter: $F"
                $MatchedProcesses += $P
                break
            }
        }
    }
}

Write-Log "Found $($MatchedProcesses.Count) browser windows matching our filters."

foreach ($M in $MatchedProcesses) {
    Write-Log "Sending CloseMainWindow to PID $($M.Id) ($($M.MainWindowTitle))"
    $M.CloseMainWindow() | Out-Null
}

Write-Log "Waiting 1.0 second for graceful close..."
Start-Sleep -Seconds 1.0

# Verify if they closed, otherwise force kill
foreach ($M in $MatchedProcesses) {
    if (-not (Get-Process -Id $M.Id -ErrorAction SilentlyContinue)) {
        Write-Log "PID $($M.Id) closed successfully."
    } else {
        Write-Log "PID $($M.Id) is still active. Force killing..."
        Stop-Process -Id $M.Id -Force -ErrorAction SilentlyContinue
    }
}

Write-Log "Monitor completed. Exiting."
