# Mariam Coffee - POS uploader
# Copies the ASEAL sales tables (Paradox .DB files) and uploads them to the Mariam Coffee website,
# so the reports update by themselves. Runs every 30 minutes through Windows Task Scheduler.
#
#   install.bat      find the ASEAL folder, schedule the upload, upload once now
#   upload-now.bat   upload now (and show what happened)
#   uninstall.bat    stop the automatic upload
#
# Only these tables are sent: the sales invoices and their lines, the cash-register history and the item names.
# The ASEAL files are only read (opened read-only, shared), never changed.

param([switch]$Install, [switch]$Uninstall, [switch]$Now)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $here 'config.json'
$statePath = Join-Path $here 'state.json'
$logPath = Join-Path $here 'upload-log.txt'
$taskName = 'Mariam Coffee - upload sales'
$tables = @('Invoices', 'StockTransDetails', 'CROldInvoices', 'CROldDetails', 'CRInvoices', 'CRDetails', 'Items')

function Log([string]$m) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  if ($Install -or $Now) { Write-Host $m }
  # keep the log small
  if ((Get-Item $logPath).Length -gt 500KB) { Get-Content $logPath -Tail 500 | Set-Content $logPath -Encoding UTF8 }
}

$cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Find-DbFolders {
  # every folder on this computer that holds Invoices.DB (ASEAL), newest first.
  # There can be old copies / backups; the one the till uses now is the one changed most recently.
  $roots = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Root -and (Test-Path $_.Root) } | ForEach-Object { $_.Root }
  $hits = @()
  foreach ($r in $roots) {
    try { $hits += Get-ChildItem -Path $r -Filter 'Invoices.DB' -Recurse -Depth 7 -File -ErrorAction SilentlyContinue }
    catch { $hits += Get-ChildItem -Path $r -Filter 'Invoices.DB' -Recurse -File -ErrorAction SilentlyContinue } # older PowerShell
  }
  return $hits | Where-Object { $_.FullName -notmatch '\\(\$Recycle\.Bin|Windows|AppData\\Local\\Temp)\\' -and $_.FullName -notmatch 'mc-upload-' } | Sort-Object LastWriteTime -Descending
}

function Save-Config { $cfg | ConvertTo-Json | Set-Content $configPath -Encoding UTF8 }

if ($Uninstall) {
  schtasks /Delete /TN $taskName /F | Out-Null
  Write-Host 'The automatic upload is stopped. You can delete this folder.'
  exit 0
}

if ($Install) {
  Write-Host 'Mariam Coffee - POS uploader setup'
  Write-Host ''
  # always choose again on install (an old copy may have been chosen before)
  if ($true) {
    Write-Host 'Looking for the ASEAL database (Invoices.DB) on all drives... this can take a few minutes.'
    $list = @(Find-DbFolders)
    $found = $null
    if ($list.Count -gt 0) {
      Write-Host ''
      Write-Host 'Found these ASEAL databases (newest first). The till uses the one changed TODAY:'
      $i = 1
      foreach ($h in $list) { Write-Host ("  [{0}]  last changed {1}   {2}" -f $i, $h.LastWriteTime.ToString('dd MMM yyyy HH:mm'), $h.DirectoryName); $i++ }
      Write-Host ''
      $ans = Read-Host 'Type the number to use and press Enter (just Enter = 1)'
      if (-not $ans) { $ans = '1' }
      if ($ans -match '^\d+$' -and [int]$ans -ge 1 -and [int]$ans -le $list.Count) { $found = $list[[int]$ans - 1].DirectoryName }
      if ($found -and ((Get-Date) - (Get-Item (Join-Path $found 'Invoices.DB')).LastWriteTime).TotalDays -gt 2) {
        Write-Host 'WARNING: this database was not changed in the last 2 days, so it is probably an old copy.'
        $ok = Read-Host 'Use it anyway? (Y/N)'
        if ($ok -notmatch '^[Yy]') { $found = $null }
      }
    }
    if (-not $found) {
      Add-Type -AssemblyName System.Windows.Forms
      $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
      $dlg.Description = 'Choose the ASEAL database folder the till uses now (the one with Invoices.DB)'
      if ($dlg.ShowDialog() -eq 'OK') { $found = $dlg.SelectedPath }
    }
    if (-not $found -or -not (Test-Path (Join-Path $found 'Invoices.DB'))) {
      Write-Host 'Invoices.DB was not found in that folder. Setup stopped.'
      exit 1
    }
    $cfg | Add-Member -NotePropertyName dbFolder -NotePropertyValue $found -Force
    Save-Config
  }
  $minutes = if ($cfg.everyMinutes) { [int]$cfg.everyMinutes } else { 30 }
  # run-hidden.vbs starts PowerShell without any window, so nothing pops up on the POS screen
  $tr = "wscript.exe `"$here\run-hidden.vbs`""
  schtasks /Create /TN $taskName /SC MINUTE /MO $minutes /TR $tr /F | Out-Null
  Write-Host "Scheduled: upload every $minutes minutes (only when the sales changed)."
  $Now = $true
  if (Test-Path $statePath) { Remove-Item $statePath -Force }
}

# ---------- upload ----------
try {
  if (-not $cfg.dbFolder -or -not (Test-Path $cfg.dbFolder)) { throw 'The ASEAL folder is not set or not found. Run install.bat again.' }
  # only the folder itself: a backup copy in a sub-folder must not be mixed in
  $files = Get-ChildItem -Path $cfg.dbFolder -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -ieq '.DB' -and $tables -contains $_.BaseName }
  if (-not $files) { throw "No sales tables (Invoices.DB ...) found in $($cfg.dbFolder)." }

  # skip when nothing changed since the last upload
  $sig = ($files | Sort-Object FullName | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join ';'
  $state = if (Test-Path $statePath) { Get-Content $statePath -Raw | ConvertFrom-Json } else { $null }
  if (-not $Now -and $state -and $state.sig -eq $sig) { exit 0 }

  # copy while ASEAL may be open: read-only, sharing allowed
  $tmp = Join-Path $env:TEMP ('mc-upload-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($cfg.dbFolder.TrimEnd('\').Length).TrimStart('\')
    $dest = Join-Path $tmp $rel
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    $in = [System.IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite')
    try { $out = [System.IO.File]::Create($dest); try { $in.CopyTo($out) } finally { $out.Close() } } finally { $in.Close() }
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = "$tmp.zip"
  [System.IO.Compression.ZipFile]::CreateFromDirectory($tmp, $zip, 'Optimal', $false)
  $size = (Get-Item $zip).Length
  if ($size -gt 24MB) { throw "The tables are $([math]::Round($size / 1MB, 1)) MB zipped; the website accepts up to 24 MB." }

  $meta = [uri]::EscapeDataString((@{ name = "POS automatic upload ($env:COMPUTERNAME)" } | ConvertTo-Json -Compress))
  $res = Invoke-WebRequest -Uri ($cfg.site.TrimEnd('/') + '/api/data') -Method Put -InFile $zip -ContentType 'application/zip' `
    -Headers @{ 'x-upload-token' = $cfg.token; 'x-meta' = $meta } -UseBasicParsing -TimeoutSec 300
  Remove-Item $tmp -Recurse -Force; Remove-Item $zip -Force
  @{ sig = $sig; at = (Get-Date).ToString('s') } | ConvertTo-Json | Set-Content $statePath -Encoding UTF8
  Log "Uploaded $($files.Count) tables ($([math]::Round($size / 1KB)) KB). Website answered $($res.StatusCode)."
} catch {
  $msg = $_.Exception.Message
  if ($_.Exception.Response) { try { $msg += ' - ' + (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { } }
  Log "FAILED: $msg"
  if ($tmp -and (Test-Path $tmp)) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  if ($zip -and (Test-Path $zip)) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
  if ($Install -or $Now) { exit 1 }
}
