#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$OutputPath = ''
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $CodePath -PathType Container)) { throw "Missing EveJS code path: $CodePath" }
$terms = '127\.0\.0\.1|localhost|EVEJS_[A-Z0-9_]*(HOST|URL|PORT)|\.listen\(|createServer\('
$extensions = @('.js','.ts','.json','.yaml','.yml','.bat','.ps1')
$files = @(Get-ChildItem -LiteralPath $CodePath -Recurse -File -ErrorAction Stop | Where-Object {
    $extensions -contains $_.Extension.ToLowerInvariant() -and
    $_.FullName -notmatch '[\\/](node_modules|\.git|dist|build|target|_local)[\\/]'
})
$results = New-Object System.Collections.Generic.List[object]
foreach ($file in $files) {
    $lineNo = 0
    foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
        $lineNo++
        if ($line -match $terms) {
            $relative = $file.FullName.Substring($CodePath.TrimEnd('\','/').Length).TrimStart('\','/')
            $results.Add([pscustomobject]@{
                File = $relative; Line = $lineNo; Excerpt = $line.Trim().Substring(0,[Math]::Min(180,$line.Trim().Length))
            })
        }
    }
}
Write-Host ("Found {0} network-related source lines across {1} files." -f $results.Count,$files.Count)
$results | Select-Object -First 80 | Format-Table -AutoSize
if ($OutputPath) {
    $destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    $results | Export-Csv -LiteralPath $destination -NoTypeInformation -Encoding UTF8
    Write-Host ("Wrote source audit: {0}" -f $destination)
}
Write-Host 'Static search only. It neither opens ports nor changes any client or server files.'
