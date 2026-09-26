param([string]$ProjectId='hackathon-c78aa',[string]$Region='us-central1')
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($args[0])" } }
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'Install Google Cloud CLI, then run gcloud auth login before deploying.' }
$activeAccount = & gcloud auth list --filter=status:ACTIVE --format='value(account)'
if (-not $activeAccount) { throw 'Run gcloud auth login first.' }
Invoke-Gcloud config set project $ProjectId
Invoke-Gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com
$serviceAccount="pulseline-sa@$ProjectId.iam.gserviceaccount.com"
& gcloud iam service-accounts describe $serviceAccount 2>$null
if ($LASTEXITCODE -ne 0) { Invoke-Gcloud iam service-accounts create pulseline-sa --display-name=PulseLine }
Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$serviceAccount" --role=roles/datastore.user --condition=None
foreach ($secret in @('gemini-api-key','pulseline-staff-pin')) {
 & gcloud secrets describe $secret 2>$null
 if ($LASTEXITCODE -ne 0) { throw "Create Secret Manager secret '$secret' with a value, then rerun this script. No secret values should be committed." }
 Invoke-Gcloud secrets add-iam-policy-binding $secret --member="serviceAccount:$serviceAccount" --role=roles/secretmanager.secretAccessor
}
& gcloud firestore databases describe --database='(default)' 2>$null
if ($LASTEXITCODE -ne 0) { Invoke-Gcloud firestore databases create --location=$Region --type=firestore-native }
& gcloud artifacts repositories describe pulseline --location=$Region 2>$null
if ($LASTEXITCODE -ne 0) { Invoke-Gcloud artifacts repositories create pulseline --repository-format=docker --location=$Region }
Invoke-Gcloud run deploy pulseline --source=. --region=$Region --allow-unauthenticated --service-account=$serviceAccount --min-instances=1 --max-instances=3 --concurrency=20 --timeout=3600 --memory=1Gi --set-secrets='GEMINI_API_KEY=gemini-api-key:latest,STAFF_PIN=pulseline-staff-pin:latest' --set-env-vars="STORE=firestore,GOOGLE_CLOUD_PROJECT=$ProjectId,URGENCY_MODE=acoustic,SPEECH_MODE=native"
$serviceUrl = & gcloud run services describe pulseline --region=$Region --format='value(status.url)'
if ($LASTEXITCODE -ne 0) { throw 'Could not obtain the deployed URL.' }
$origins="$serviceUrl,https://$ProjectId.web.app,https://$ProjectId.firebaseapp.com"
Invoke-Gcloud run services update pulseline --region=$Region --update-env-vars="^|^ALLOWED_ORIGINS=$origins"
Write-Host "PulseLine deployed: $serviceUrl"
Write-Host 'For optional Firebase Hosting, run npm run build and scripts/configure-hosting.ps1 with this URL, then firebase deploy --only hosting,firestore:rules.'
