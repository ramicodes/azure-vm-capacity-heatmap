param(
  [Parameter(Mandatory)][string]$SubscriptionId,
  [Parameter(Mandatory)][string]$ResourceGroup,
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$ClientId,
  [Parameter(Mandatory)][string]$TenantId
)

$ErrorActionPreference = 'Stop'
$previousLocation = Get-Location
$variables = @(
  'VITE_ARM_MODE', 'VITE_BASE', 'VITE_AZURE_CLIENT_ID',
  'VITE_AZURE_TENANT_ID', 'VITE_AZURE_REDIRECT_URI', 'SWA_CLI_DEPLOYMENT_TOKEN'
)
$previous = @{}
foreach ($key in $variables) {
  $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}

try {
  Set-Location (Split-Path $PSScriptRoot -Parent)
  $hostname = az staticwebapp show --subscription $SubscriptionId --resource-group $ResourceGroup --name $Name --query defaultHostname --output tsv
  if ($LASTEXITCODE -ne 0 -or !$hostname -or $hostname -notmatch '^[a-z0-9.-]+\.azurestaticapps\.net$') {
    throw 'The target Static Web App could not be resolved.'
  }
  $env:VITE_ARM_MODE = 'standalone'
  $env:VITE_BASE = '/'
  $env:VITE_AZURE_CLIENT_ID = $ClientId
  $env:VITE_AZURE_TENANT_ID = $TenantId
  $env:VITE_AZURE_REDIRECT_URI = "https://$hostname/"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'The hosted build failed.' }

  $env:SWA_CLI_DEPLOYMENT_TOKEN = az staticwebapp secrets list --subscription $SubscriptionId --resource-group $ResourceGroup --name $Name --query properties.apiKey --output tsv
  if ($LASTEXITCODE -ne 0 -or !$env:SWA_CLI_DEPLOYMENT_TOKEN) {
    throw 'The deployment credential could not be obtained.'
  }
  npx --yes '@azure/static-web-apps-cli@2.1.0' deploy dist --api-location api --api-language node --api-version 22 --env production --no-use-keychain
  if ($LASTEXITCODE -ne 0) { throw 'The Static Web App deployment failed.' }
  Write-Output "Deployed to https://$hostname/"
} finally {
  foreach ($key in $variables) {
    [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
  }
  Set-Location $previousLocation
}
