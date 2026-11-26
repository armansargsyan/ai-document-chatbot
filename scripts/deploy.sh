#!/usr/bin/env bash
# Deploys the api to Cloud Run and the web app to Firebase Hosting.
#
#   scripts/deploy.sh            # api + web
#   scripts/deploy.sh api        # api only
#   scripts/deploy.sh web        # web (Hosting) only
#
# Prereqs: gcloud + firebase CLIs logged in with access to the project.
# LLM keys are read from Secret Manager (see README "Deploy"); secrets that
# don't exist yet are skipped, and the matching models show as unavailable.
set -euo pipefail

PROJECT="${PROJECT:-ai-doc-chatbot-demo}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-api}"
SERVICE_ACCOUNT="api-runtime@${PROJECT}.iam.gserviceaccount.com"
TARGET="${1:-all}"

cd "$(dirname "$0")/.."

deploy_api() {
  echo "▸ Building api"
  # The webpack build also emits a pruned package.json + package-lock.json.
  npx nx build api --skip-nx-cache
  cp apps/api/Dockerfile dist/apps/api/Dockerfile

  # Public Firebase web config (not secret) — served to the browser by GET /api/config.
  local web_app_id
  web_app_id="$(firebase apps:list WEB --project "$PROJECT" --json |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result[0].appId))')"
  local api_key
  api_key="$(firebase apps:sdkconfig WEB "$web_app_id" --project "$PROJECT" --json |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.sdkConfig.apiKey))')"
  local sender_id="${web_app_id#1:}"; sender_id="${sender_id%%:*}"

  # Attach only the LLM key secrets that exist.
  local secrets=()
  for name in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY; do
    if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
      secrets+=("${name}=${name}:latest")
    else
      echo "  (secret $name not found — skipping)"
    fi
  done
  local secret_flag=(--clear-secrets)
  if ((${#secrets[@]})); then
    secret_flag=(--set-secrets "$(IFS=,; echo "${secrets[*]}")")
  fi

  echo "▸ Deploying api to Cloud Run ($SERVICE, $REGION)"
  gcloud run deploy "$SERVICE" \
    --project "$PROJECT" --region "$REGION" \
    --source dist/apps/api \
    --service-account "$SERVICE_ACCOUNT" \
    --allow-unauthenticated \
    --memory 1Gi --cpu 1 \
    --min-instances 0 --max-instances 2 \
    --timeout 300 \
    --set-env-vars "NODE_ENV=production,FIREBASE_PROJECT_ID=${PROJECT},FIREBASE_STORAGE_BUCKET=${PROJECT}.firebasestorage.app,FIREBASE_API_KEY=${api_key},FIREBASE_AUTH_DOMAIN=${PROJECT}.firebaseapp.com,FIREBASE_APP_ID=${web_app_id},FIREBASE_MESSAGING_SENDER_ID=${sender_id}" \
    "${secret_flag[@]}" \
    --quiet
}

deploy_web() {
  echo "▸ Building web"
  npx nx build web --configuration=production --skip-nx-cache
  echo "▸ Deploying web to Firebase Hosting"
  firebase deploy --only hosting --project "$PROJECT"
}

case "$TARGET" in
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api; deploy_web ;;
  *) echo "usage: $0 [all|api|web]" >&2; exit 1 ;;
esac

echo "✓ Done: https://${PROJECT}.web.app"
