param([Parameter(Mandatory=$true)][string]$GatewayUrl)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($GatewayUrl -notmatch '^https://[a-zA-Z0-9.-]+\.run\.app/?$') { throw 'Expected an HTTPS Cloud Run URL.' }
$config='window.PULSELINE_GATEWAY=' + (ConvertTo-Json $GatewayUrl -Compress) + ';'
Set-Content -LiteralPath dist/client/gateway-config.js -Value $config
$html=Get-Content -LiteralPath dist/client/index.html -Raw
$html=$html.Replace('</head>','<script src="/gateway-config.js"></script></head>')
Set-Content -LiteralPath dist/client/index.html -Value $html
