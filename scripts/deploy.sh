#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ID="${1:-spry-catcher-509805-u4}"
REGION="${2:-us-central1}"
SA="pulseline-sa@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create pulseline-sa --display-name=PulseLine
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/datastore.user --condition=None --quiet >/dev/null
for secret in gemini-api-key pulseline-staff-pin; do
  if ! gcloud secrets describe "$secret" >/dev/null 2>&1; then
    echo "Missing Secret Manager secret: $secret. Create it with a value and rerun." >&2
    exit 1
  fi
  gcloud secrets add-iam-policy-binding "$secret" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
done
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || gcloud firestore databases create --location="$REGION" --type=firestore-native
gcloud artifacts repositories describe pulseline --location="$REGION" >/dev/null 2>&1 || gcloud artifacts repositories create pulseline --repository-format=docker --location="$REGION"
gcloud run deploy pulseline --source=. --region="$REGION" --allow-unauthenticated --service-account="$SA" --min-instances=1 --max-instances=3 --concurrency=20 --timeout=3600 --memory=1Gi --set-secrets='GEMINI_API_KEY=gemini-api-key:latest,STAFF_PIN=pulseline-staff-pin:latest' --set-env-vars="STORE=firestore,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,URGENCY_MODE=acoustic,SPEECH_MODE=native" --quiet
SERVICE_URL="$(gcloud run services describe pulseline --region="$REGION" --format='value(status.url)')"
gcloud run services update pulseline --region="$REGION" --update-env-vars="^|^ALLOWED_ORIGINS=$SERVICE_URL,https://$PROJECT_ID.web.app,https://$PROJECT_ID.firebaseapp.com" --quiet
echo "PulseLine deployed: $SERVICE_URL"
