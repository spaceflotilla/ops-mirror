# One-shot: create GitLab project webhooks for Flotilla preview orchestrator.
# Usage (PowerShell, VPN on if needed):
#   $env:GITLAB_TOKEN = 'glpat-...'   # PAT with api scope (or hooks + read_api)
#   .\scripts\setup-gitlab-webhooks.ps1

$ErrorActionPreference = 'Stop'
$token = $env:GITLAB_TOKEN
if (-not $token) {
  Write-Error "Set GITLAB_TOKEN to a GitLab personal access token (api or write hooks + read_api)."
}

$gitlabUrl = if ($env:GITLAB_URL) { $env:GITLAB_URL.TrimEnd('/') } else { 'https://gitlab.flotilla.space' }
$webhookUrl = if ($env:ORCHESTRATOR_WEBHOOK_URL) { $env:ORCHESTRATOR_WEBHOOK_URL } else { 'https://ops-mirror-production.up.railway.app/webhooks/gitlab' }
$webhookSecret = $env:GITLAB_WEBHOOK_SECRET
if (-not $webhookSecret) {
  Write-Error "Set GITLAB_WEBHOOK_SECRET to the same value as on Railway (orchestrator)."
}

$projects = @(
  'web/landing-page',
  'web/trades',
  'web/orbit',
  'web/react_deck',
  'web/astrolabe',
  'web/ops'
)

$headers = @{
  'PRIVATE-TOKEN' = $token
  'Content-Type'  = 'application/json'
}

# Self-signed GitLab certs are common on the NUC
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

foreach ($path in $projects) {
  $encoded = [uri]::EscapeDataString($path)
  $listUri = "$gitlabUrl/api/v4/projects/$encoded/hooks"
  Write-Host "=== $path ==="

  try {
    $existing = Invoke-RestMethod -Uri $listUri -Headers $headers -Method Get
  } catch {
    Write-Warning "Cannot list hooks for ${path}: $($_.Exception.Message)"
    continue
  }

  $match = @($existing | Where-Object { $_.url -eq $webhookUrl })
  if ($match.Count -gt 0) {
    Write-Host "Already configured (id=$($match[0].id))"
    continue
  }

  $body = @{
    url                      = $webhookUrl
    token                    = $webhookSecret
    push_events              = $true
    merge_requests_events    = $true
    enable_ssl_verification  = $true
  } | ConvertTo-Json

  try {
    $created = Invoke-RestMethod -Uri $listUri -Headers $headers -Method Post -Body $body
    Write-Host "Created hook id=$($created.id)"
  } catch {
    Write-Warning "Failed to create hook for ${path}: $($_.Exception.Message)"
  }
}

Write-Host "Done. Test a push to a project-color-animal branch, then check the dashboard."
