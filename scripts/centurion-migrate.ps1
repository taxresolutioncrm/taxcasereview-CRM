param(
  [ValidateSet('Audit','DeployApprovedFunctions')]
  [string]$Mode='Audit',
  [string]$ProjectRef='rkniemzmivnuhpdwkduc',
  [string]$ApprovedFile='',
  [switch]$IUnderstandThisChangesCenturion
)
$ErrorActionPreference='Stop'
$expected='rkniemzmivnuhpdwkduc'
if ($ProjectRef -ne $expected) { throw "Safety stop: only Centurion project $expected is allowed" }
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$cli='npx'
& $cli supabase --version
if ($LASTEXITCODE -ne 0) { throw 'Supabase CLI unavailable' }
if (-not (Test-Path 'supabase/functions')) { throw 'Run this script from the TaxRes repository checkout' }
$all=@(Get-ChildItem supabase/functions -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'index.ts') } | Select-Object -ExpandProperty Name | Sort-Object)
$excluded='nashville|cloudcpa|romylabs-|platform-|admin-|test-|demo|taxres-family'
$candidates=@($all | Where-Object { $_ -notmatch $excluded })
$outDir=Join-Path $PSScriptRoot 'audit-output'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$all | Set-Content (Join-Path $outDir 'all-source-functions.txt')
$candidates | Set-Content (Join-Path $outDir 'review-candidates-not-approved.txt')
Write-Host "Source Edge Function folders: $($all.Count)"
Write-Host "Review candidates (NOT approved to deploy): $($candidates.Count)"
Write-Host "Review exclusions match: $excluded"
if ($Mode -eq 'Audit') {
  Write-Host 'READ-ONLY audit finished; no database changes or deployments.'
  Write-Host 'Next: review function dependencies and secrets; create an approved function list manually.'
  exit 0
}
if (-not $IUnderstandThisChangesCenturion) { throw 'Safety stop: explicit confirmation switch required' }
if (-not $ApprovedFile -or -not (Test-Path $ApprovedFile)) { throw 'Approved function list is required' }
$approved=@(Get-Content $ApprovedFile | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | ForEach-Object { $_.Trim() })
if (-not $approved.Count) { throw 'Approved list is empty' }
if ($approved | Where-Object { $_ -notin $all }) { throw 'Approved list includes a function not found in source' }
if ($approved | Where-Object { $_ -match $excluded }) { throw 'Safety stop: approved list contains an excluded office/platform function' }
Write-Host 'Only specifically reviewed functions will be deployed:'
$approved | ForEach-Object { Write-Host "  $_" }
$confirm=Read-Host "Type DEPLOY CENTURION to confirm"
if ($confirm -cne 'DEPLOY CENTURION') { throw 'Deployment cancelled' }
foreach ($fn in $approved) {
  & $cli supabase functions deploy $fn --project-ref $expected
  if ($LASTEXITCODE -ne 0) { throw "Deployment failed for $fn; STOPPING" }
}
Write-Host 'Functions submitted. Verify each deployment, JWT settings, secrets and live workflow before marking complete.'
