[CmdletBinding()]
param(
  [Parameter(Mandatory)][guid]$SubscriptionId,
  [Parameter(Mandatory)][string]$ResourceGroup,
  [Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]{2,40}$')][string]$AppName,
  [Parameter(Mandatory)][guid]$TenantId,
  [Parameter(Mandatory)][guid]$ClientId,
  [Parameter(Mandatory)][guid[]]$AllowedUserIds,
  [string]$Repository = "ramicodes/azure-vm-capacity-planner",
  [string]$Branch = "main",
  [string]$Location = "eastus2",
  [switch]$ValidateOnly
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
function Invoke-AzJson {
  param([string[]]$Arguments)
  $result = & az @Arguments --only-show-errors --output json
  if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: $($Arguments[0..1] -join ' ')" }
  if ($result) { return ($result -join "`n" | ConvertFrom-Json) }
}
$account = Invoke-AzJson @("account", "show", "--subscription", "$SubscriptionId")
if ($account.tenantId -ne "$TenantId") { throw "The selected subscription belongs to a different tenant." }
$registration = Invoke-AzJson @("ad", "app", "show", "--id", "$ClientId")
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $parameters = @{
    appName = @{ value = $AppName }; location = @{ value = $Location }
    tenantId = @{ value = "$TenantId" }; clientId = @{ value = "$ClientId" }
    allowedUserIds = @{ value = @($AllowedUserIds | ForEach-Object { "$_" }) }
    repository = @{ value = $Repository }; branch = @{ value = $Branch }
  }
  $parameterPath = Join-Path $temp "parameters.json"
  $parameters | ConvertTo-Json -Depth 12 | Set-Content -Path $parameterPath -Encoding utf8
  if ($ValidateOnly) {
    Invoke-AzJson @("deployment", "group", "validate", "--subscription", "$SubscriptionId", "--resource-group", $ResourceGroup,
      "--template-file", (Join-Path $root "infra\app-service.json"), "--parameters", "@$parameterPath") | Out-Null
    Write-Output "B1 preflight validation succeeded in $Location. No resources created."
    return
  }
  $deployment = Invoke-AzJson @("deployment", "group", "create", "--subscription", "$SubscriptionId", "--resource-group", $ResourceGroup,
    "--name", "$AppName-infrastructure", "--template-file", (Join-Path $root "infra\app-service.json"), "--parameters", "@$parameterPath")
  $out = $deployment.properties.outputs
  $siteId = $out.appId.value
  $hostname = $out.hostname.value
  foreach ($assignment in @(
    @{ Principal = $out.runtimePrincipalId.value; Role = "acdd72a7-3385-48ef-bd42-f606fba81ae7"; Scope = "/subscriptions/$SubscriptionId" },
    @{ Principal = $out.deployPrincipalId.value; Role = "de139f84-1756-47ae-9be6-808fbbe84772"; Scope = $siteId }
  )) {
    Invoke-AzJson @("role", "assignment", "create", "--subscription", "$SubscriptionId", "--assignee-object-id", $assignment.Principal,
      "--assignee-principal-type", "ServicePrincipal", "--role", $assignment.Role, "--scope", $assignment.Scope) | Out-Null
  }
  $callback = "https://$hostname/.auth/login/aad/callback"
  $uris = @($registration.web.redirectUris)
  if ($uris -notcontains $callback -or !$registration.web.implicitGrantSettings.enableIdTokenIssuance) {
    $patchPath = Join-Path $temp "web.json"
    $web = @{
      redirectUris = if ($uris -contains $callback) { @($uris) } else { @($uris) + @($callback) }
      implicitGrantSettings = @{
        enableIdTokenIssuance = $true
        enableAccessTokenIssuance = [bool]$registration.web.implicitGrantSettings.enableAccessTokenIssuance
      }
    }
    @{ web = $web } | ConvertTo-Json -Depth 6 | Set-Content $patchPath -Encoding utf8
    Invoke-AzJson @("rest", "--method", "PATCH", "--url", "https://graph.microsoft.com/v1.0/applications/$($registration.id)",
      "--headers", "Content-Type=application/json", "--body", "@$patchPath") | Out-Null
  }
  $credential = @{
    name = "$AppName-easyauth"; issuer = "https://login.microsoftonline.com/$TenantId/v2.0"
    subject = $out.authPrincipalId.value; audiences = @("api://AzureADTokenExchange")
    description = "Secretless App Service sign-in; not ARM data access."
  }
  $credentials = @(Invoke-AzJson @("ad", "app", "federated-credential", "list", "--id", $registration.id))
  $existing = @($credentials | Where-Object name -eq $credential.name)
  if (!$existing.Count) {
    $credentialPath = Join-Path $temp "credential.json"
    $credential | ConvertTo-Json -Depth 5 | Set-Content $credentialPath -Encoding utf8
    Invoke-AzJson @("ad", "app", "federated-credential", "create", "--id", $registration.id, "--parameters", $credentialPath) | Out-Null
  } elseif ($existing[0].subject -ne $credential.subject -or $existing[0].issuer -ne $credential.issuer -or
    @($existing[0].audiences).Count -ne 1 -or $existing[0].audiences[0] -cne $credential.audiences[0]) {
    throw "An existing authentication federation has a different identity or audience. Review it instead of overwriting."
  }
  [pscustomobject]@{
    AppName = $AppName; Url = "https://$hostname"; ResourceGroup = $ResourceGroup
    SubscriptionId = "$SubscriptionId"; TenantId = "$TenantId"; DeployClientId = $out.deployClientId.value
  } | ConvertTo-Json
} finally {
  foreach ($file in @("parameters.json", "web.json", "credential.json")) {
    $target = Join-Path $temp $file
    if (Test-Path $target) { Remove-Item -LiteralPath $target }
  }
  Remove-Item -LiteralPath $temp
}
