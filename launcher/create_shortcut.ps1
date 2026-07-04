# ============================================================
#  CERES — Shortcut Creator
#  Run once from the launcher\ folder.
#  Creates:
#    ✓  Ceres\CERES.lnk   ← drag this to your Desktop
#    ✓  Desktop\CERES.lnk   ← also placed on Desktop
# ============================================================

$LauncherDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir   = Split-Path -Parent $LauncherDir

$PngSrc       = Join-Path $LauncherDir "ceres_icon.png"
$IcoPath      = Join-Path $LauncherDir "ceres_icon.ico"
$VbsPath      = Join-Path $LauncherDir "launch_ceres.vbs"

$DesktopDir   = [System.Environment]::GetFolderPath("Desktop")
$LnkDesktop   = Join-Path $DesktopDir  "CERES.lnk"
$LnkRepo      = Join-Path $ProjectDir  "CERES.lnk"   # visible in repo!

# ── 1. PNG → multi-size ICO via Python Pillow (standard Windows BMP formatting) ──
Write-Host "Building ICO..."
if (Test-Path $PngSrc) {
    $PythonExe = Join-Path $ProjectDir "venv\Scripts\python.exe"
    if (Test-Path $PythonExe) {
        $cmd = "from PIL import Image; img = Image.open(r'$PngSrc'); img.save(r'$IcoPath', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])"
        & $PythonExe -c $cmd
        if (Test-Path $IcoPath) {
            $kb = [math]::Round((Get-Item $IcoPath).Length / 1KB, 1)
            Write-Host "  ICO: $IcoPath ($kb KB, 6 sizes, verified)"
        } else {
            Write-Warning "Python completed but ICO file was not generated."
        }
    } else {
        Write-Warning "Python environment not found. Unable to compile ICO file."
    }
} else {
    Write-Warning "PNG not found -- shortcut will use default icon."
}

# ── 2. Helper: create one shortcut ───────────────────────────────────────────
function New-CeresShortcut([string]$Path) {
    if (Test-Path $Path) { Remove-Item $Path -Force }
    $ws  = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($Path)
    $lnk.TargetPath       = "wscript.exe"
    $lnk.Arguments        = """$VbsPath"""
    $lnk.WorkingDirectory = $ProjectDir
    $lnk.Description      = "CERES - Autonomous Fish Pond Monitoring Console"
    $lnk.WindowStyle      = 1
    if (Test-Path $IcoPath) { $lnk.IconLocation = "$IcoPath, 0" }
    $lnk.Save()
}

# ── 3. Create shortcuts ───────────────────────────────────────────────────────
Write-Host "Cleaning up legacy CERES OS shortcuts..."
$OldLnkDesktop = Join-Path $DesktopDir "CERES OS.lnk"
$OldLnkRepo    = Join-Path $ProjectDir "CERES OS.lnk"
if (Test-Path $OldLnkDesktop) { Remove-Item $OldLnkDesktop -Force -ErrorAction SilentlyContinue }
if (Test-Path $OldLnkRepo) { Remove-Item $OldLnkRepo -Force -ErrorAction SilentlyContinue }

Write-Host "Creating shortcuts..."
New-CeresShortcut -Path $LnkDesktop
New-CeresShortcut -Path $LnkRepo

# ── 4. Aggressively rebuild Windows icon cache ────────────────────────────────
Write-Host "Rebuilding icon cache (this will briefly restart Explorer)..."
try {
    # Broadcast shell association change via Win32
    $Sig = @'
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@
    $Shell32 = Add-Type -MemberDefinition $Sig -Name "Win32Shell32_$(Get-Random)" -Namespace "Win32" -PassThru
    # SHCNE_ASSOCCHANGED = 0x08000000; SHCNF_FLUSH = 0x1000
    $Shell32::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Host "  Shell association change notified."

    # Also delete the icon cache database so Windows rebuilds from scratch
    $LocalAppData = [System.Environment]::GetFolderPath("LocalApplicationData")
    $LegacyIconCache = Join-Path $LocalAppData "IconCache.db"
    $IconCacheDb  = Join-Path $LocalAppData "Microsoft\Windows\Explorer\iconcache*.db"
    $ThumbCacheDb = Join-Path $LocalAppData "Microsoft\Windows\Explorer\thumbcache*.db"

    # Stop Explorer, delete caches, restart
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    if (Test-Path $LegacyIconCache) { Remove-Item $LegacyIconCache -Force -ErrorAction SilentlyContinue }
    Get-Item $IconCacheDb  -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-Item $ThumbCacheDb -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
    Start-Process explorer
    Write-Host "  Icon cache cleared and Explorer restarted."
} catch {
    Write-Warning "Could not fully refresh icon cache: $_"
}

Write-Host ""
Write-Host "============================================="
Write-Host " Done!"
Write-Host " > Desktop:       CERES.lnk"
Write-Host " > Repository:    CERES.lnk  (drag to Desktop anytime)"
Write-Host "============================================="
