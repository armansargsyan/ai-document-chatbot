# AI Document Chatbot

Nx monorepo for an AI document chatbot.

| Project           | Path          | Stack                                                                |
| ----------------- | ------------- | -------------------------------------------------------------------- |
| `web`             | `apps/web`    | Angular 22 (standalone, signals, zoneless), Tailwind v4, spartan/ui  |
| `api`             | `apps/api`    | NestJS 11 (ES modules)                                               |
| `shared`          | `libs/shared` | Types/DTOs shared by `web` and `api` (`@ai-document-chatbot/shared`) |
| `button`, `utils` | `libs/ui`     | spartan/ui helm primitives (`@spartan-ng/helm/*`)                    |

## Getting started

```sh
npm install
cp .env.example .env   # fill in keys
npm start              # serves api (http://localhost:3000/api) + web (http://localhost:4200)
```

`web` proxies `/api` to the Nest server (`apps/web/proxy.conf.json`).

## Scripts

```sh
npm run build          # build all projects
npm test               # unit tests (Vitest for all projects)
npm run lint           # ESLint (incl. module-boundary rules)
npm run format         # Prettier
npx nx graph           # project graph
```

Add spartan/ui primitives with `npx nx g @spartan-ng/cli:ui <name>`.

## Firebase

Project: `ai-doc-chatbot-demo` (default in `.firebaserc`). Uses Authentication (Google sign-in), Cloud Firestore (`nam5`, native mode) and Cloud Storage.

- **Security rules** (`firestore.rules`, `storage.rules`) deny all direct client access. The browser only signs in with Firebase Auth; every read and write goes through the NestJS api, which uses the Firebase Admin SDK.
- **Web config**: run `firebase apps:sdkconfig web` and copy the values into the `FIREBASE_*` entries in `.env`.
- **Admin credentials (local)**: run `gcloud auth application-default login`, or point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account key. Never commit the key.
  With `gcloud` user credentials, also run `gcloud auth application-default set-quota-project ai-doc-chatbot-demo` so quota and billing go to this project. User credentials carry no project ID, so the api must pass `FIREBASE_PROJECT_ID` to the Admin SDK explicitly (planned in #3).
- **Emulators**: `firebase emulators:start` runs Auth (9099), Firestore (8080) and Storage (9199) locally with the Emulator UI on http://localhost:4000. Requires Java 11+. To point the api at them, set `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` and `FIREBASE_STORAGE_EMULATOR_HOST` in `.env` (values in `.env.example`); without them the api talks to the live project.
- **Deploy rules/indexes**: `firebase deploy --only firestore,storage`.

The project is on the Blaze plan (Cloud Storage requires it) with a $3/month budget alert. The default bucket `ai-doc-chatbot-demo.firebasestorage.app` is in `us-central1`, inside the Cloud Storage free tier.

## Deploy

Live: **https://ai-doc-chatbot-demo.web.app**

```
Browser ─► Firebase Hosting ─┬─ /        → Angular app (dist/apps/web/browser)
                             └─ /api/**  → Cloud Run "api" (us-central1) ─► Firestore · Storage · Auth · LLM APIs
```

- **api**: Cloud Run service `api` in `us-central1`, built from `apps/api/Dockerfile` (Node 24) on Cloud Build. Runs as the `api-runtime` service account, which only has Firestore access (`roles/datastore.user`) and object access on the default bucket. Max 2 instances (caps cost and keeps the in-memory rate limits meaningful), scales to zero, 1 GiB, 300 s timeout.
- **web**: Firebase Hosting. `/api/**` is rewritten to Cloud Run (same origin, no CORS). Hashed JS/CSS are cached for a year; HTML is `no-cache`.
- **Config**: the public Firebase web config is set as Cloud Run env vars by the deploy script. LLM keys come from **Secret Manager**; never from files.

Note: requests through Hosting are limited to **60 s**. Typical answers and PDFs finish well within that; very large uploads could hit it.

### Redeploy

```sh
scripts/deploy.sh          # api + web
scripts/deploy.sh api      # Cloud Run only
scripts/deploy.sh web      # Hosting only
firebase deploy --only firestore,storage   # rules / indexes
```

Needs `gcloud` and `firebase` logged in with access to the project. The script always passes `--project ai-doc-chatbot-demo`.

### LLM keys (Secret Manager)

Create each secret in **your own terminal** (the key is read without echoing, so it never lands in shell history or logs):

```sh
P=ai-doc-chatbot-demo
for NAME in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY; do
  printf '%s (Enter to skip): ' "$NAME"; read -rs KEY; echo
  [ -z "$KEY" ] && continue
  printf '%s' "$KEY" | gcloud secrets create "$NAME" --data-file=- --replication-policy=automatic --project "$P"
  gcloud secrets add-iam-policy-binding "$NAME" --project "$P" \
    --member "serviceAccount:api-runtime@$P.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor
  unset KEY
done
scripts/deploy.sh api   # attaches the secrets that exist
```

`OPENAI_API_KEY` is required for PDF ingestion (embeddings); at least one of the three enables chat. Set a monthly spending limit in each provider's dashboard. To rotate a key: `printf '%s' "$KEY" | gcloud secrets versions add NAME --data-file=-` then `scripts/deploy.sh api`.
