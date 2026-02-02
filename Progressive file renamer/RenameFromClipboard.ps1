# RenameFromClipboard.ps1
# Reads clipboard lines like: POLICY - TITLE - DATE
# Reads dragged file paths from a text file (one per line).

param(
  [Parameter(Mandatory=$true)]
  [string]$PathList
)

$ErrorActionPreference = 'Stop'

function Norm([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return '' }
  $s = $s.ToLowerInvariant()
  $s = $s -replace '\.pdf$',''
  $s = $s -replace '\(pdf\)',''
  $s = $s -replace '[^a-z0-9]+',' '
  $s = $s -replace '\s+',' '
  $s.Trim()
}

function SanitizeFileName([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return '' }
  foreach ($ch in [IO.Path]::GetInvalidFileNameChars()) { $s = $s.Replace($ch, '-') }
  $s = $s -replace '\s+',' '
  $s.Trim()
}

try {
  if (-not (Test-Path -LiteralPath $PathList -PathType Leaf)) {
    throw "Path list file not found: $PathList"
  }

  $rawPaths = Get-Content -LiteralPath $PathList | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($rawPaths.Count -eq 0) { throw "No paths in path list file." }

  # Clipboard
  $clip = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($clip)) { throw "Clipboard is empty. Click Tampermonkey 'Copy for BAT' again." }
  if ($clip.Length -gt 0 -and $clip[0] -eq [char]0xFEFF) { $clip = $clip.Substring(1) }

  $lines = $clip -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($lines.Count -eq 0) { throw "Clipboard had no usable lines." }

  # Map: normalized TITLE -> list of full clipboard lines (handles duplicates)
  $map = @{}
  foreach ($line in $lines) {
    $line2 = [regex]::Replace($line, '[\u0000-\u001F\u007F]', '').Trim()
    if (-not $line2) { continue }

    $parts = $line2 -split '\s-\s'
    if ($parts.Count -lt 3) { continue }

    $title = ($parts[1..($parts.Count-2)] -join ' - ').Trim()
    $key = Norm $title
    if (-not $key) { continue }

    if (-not $map.ContainsKey($key)) { $map[$key] = New-Object System.Collections.ArrayList }
    [void]$map[$key].Add($line2)
  }
  if ($map.Keys.Count -eq 0) { throw "Could not parse clipboard lines. Expected: POLICY - TITLE - DATE" }

  # Files from list
  $files = @()
  foreach ($p in $rawPaths) {
    # strip surrounding quotes if present
    if ($p.StartsWith('"') -and $p.EndsWith('"') -and $p.Length -ge 2) { $p = $p.Substring(1, $p.Length-2) }

    if (Test-Path -LiteralPath $p -PathType Leaf) {
      $it = Get-Item -LiteralPath $p
      if ($it.Extension -and $it.Extension.ToLowerInvariant() -eq '.pdf') { $files += $it }
    }
  }
  if ($files.Count -eq 0) { throw "No valid PDF files detected in dragged items." }

  $renamed = 0
  $noMatch = 0
  $ambig = 0

  foreach ($f in $files) {
    $fileKey = Norm $f.Name
    if (-not $fileKey) { $noMatch++; continue }

    if (-not $map.ContainsKey($fileKey)) { $noMatch++; continue }

    $list = $map[$fileKey]
    if ($list.Count -ne 1) { $ambig++; continue }

    $fullLine = [string]$list[0]
    $base = SanitizeFileName $fullLine
    if (-not $base) { $noMatch++; continue }

    $dest = Join-Path $f.DirectoryName ($base + ".pdf")
    if (Test-Path -LiteralPath $dest) {
      $k = 2
      do {
        $dest = Join-Path $f.DirectoryName ($base + " ($k).pdf")
        $k++
      } while (Test-Path -LiteralPath $dest)
    }

    Rename-Item -LiteralPath $f.FullName -NewName (Split-Path -Leaf $dest)
    $renamed++
  }

  if ($renamed -eq 0) {
    throw "Renamed 0 files. NoMatch=$noMatch Ambiguous=$ambig. (Do filenames match titles like 'Notice.pdf'?)"
  }

  exit 0
}
catch {
  Write-Host "ERROR: $($_.Exception.Message)"
  exit 1
}