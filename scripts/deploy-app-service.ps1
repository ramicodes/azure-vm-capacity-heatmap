[CmdletBinding()]
param(
  [Parameter(Mandatory)][guid]$SubscriptionId,
  [Parameter(Mandatory)][string]$ResourceGroup,
  [Parameter(Mandatory)][string]$AppName
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$location = Get-Location
$savedMode = $env:VITE_ARM_MODE
$savedBase = $env:VITE_BASE
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "planner-deploy-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $temp | Out-Null
$release = Join-Path $temp "release"
$zip = Join-Path $temp "release.zip"
try {
  Set-Location $root
  $env:VITE_ARM_MODE = "hosted"
  $env:VITE_BASE = "/"
  $tests = @(Get-ChildItem -LiteralPath (Join-Path $root "tests") -Filter "*.test.mjs" | ForEach-Object FullName)
  & node --experimental-strip-types --test @tests
  if ($LASTEXITCODE -ne 0) { throw "Application tests failed. Nothing was deployed." }
  & node scripts\package-app-service.mjs $release
  if ($LASTEXITCODE -ne 0) { throw "Hosted build or runtime packaging failed. Nothing was deployed." }
  Compress-Archive -Path (Join-Path $release "*") -DestinationPath $zip
  & az webapp deploy --subscription "$SubscriptionId" --resource-group $ResourceGroup --name $AppName `
    --src-path $zip --type zip --clean true --restart true --track-status true --timeout 600000 --only-show-errors --output none
  if ($LASTEXITCODE -ne 0) { throw "App Service did not confirm successful deployment." }
  $site = & az webapp show --subscription "$SubscriptionId" --resource-group $ResourceGroup --name $AppName --only-show-errors -o json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$site.defaultHostName) { throw "Could not resolve the deployed hostname." }
  $url = "https://$($site.defaultHostName)"
  $health = Invoke-RestMethod "$url/healthz" -TimeoutSec 30
  if ($health.status -ne "ok") { throw "Deployed backend health did not pass." }
  $anonymous = Invoke-WebRequest "$url/api/arm?kind=subscriptions" -MaximumRedirection 0 -SkipHttpErrorCheck -ErrorAction SilentlyContinue
  if ([int]$anonymous.StatusCode -notin @(302, 401, 403)) { throw "Anonymous API denial was not verified." }
  Write-Output "Deployment healthy and anonymous API denied: $url. Interactive sign-in and managed-identity Azure reads still require verification."
} finally {
  $env:VITE_ARM_MODE = $savedMode
  $env:VITE_BASE = $savedBase
  Set-Location $location
  if (Test-Path -LiteralPath $release) { Remove-Item -LiteralPath $release -Recurse -Force }
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  Remove-Item -LiteralPath $temp
}
