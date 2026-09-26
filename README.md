# PulseLine

A tablet-first, bilingual hospital interpretation prototype with required patient intake and consent, English ⇄ Hindi or Telugu live/rehearsal sessions, traceable clinical extraction, clinician review, encounter history, and separate server-generated reports.

## Run locally

Requires Node.js 22+.

```powershell
npm ci
npm run build
npm start
```

Open http://localhost:8080. Register a test patient, record consent, choose **Guided rehearsal**, start a session, and play the four turns. End the session, review every extracted item, enter the reviewer identity, and generate the patient, clinical, transcript, and JSON reports. Rehearsal is explicitly scripted and does not call Gemini.

## Hospital workflow

The interface requires patient identity, visit details, preferred language, emergency contact, department, and transcription/translation consent before a session can begin. Each completed turn is classified and analyzed with deterministic, negation-aware rules. Extracted facts and attention flags retain their source turn and remain unconfirmed until a clinician confirms, edits, marks uncertain, or dismisses them.

Completed encounters can be found by patient ID, reopened, exported again, used to start a new encounter, or deleted. Local records are kept in `DATA_DIR`; Firestore is used when `STORE=firestore`. `RETENTION_DAYS` defaults to 30 and is applied to local records at startup.

Reports are generated on the server as `Patient_Summary_<patient-id>.pdf`, `Clinical_Handoff_<patient-id>.pdf`, `Bilingual_Transcript_<patient-id>.pdf`, and `Structured_<patient-id>.json`. Confirmed facts appear as confirmed; unresolved information remains clearly separated. The original transcript is preserved when review items are edited.

For live interpretation, copy `.env.example` to `.env`, set `GEMINI_API_KEY`, and restart the server. The key stays server-side. Choose **Live microphone**, discover devices, and select separate doctor/patient microphones. If only one microphone is available, alternate the microphone buttons. Use headphones to reduce feedback. Microphone access requires localhost or HTTPS.

## Included

- TypeScript HTTP/WebSocket gateway, validated messages, per-speaker sequence checks, payload/rate/connection limits, heartbeat, 50-minute session cap, origin allowlist, optional staff PIN.
- AudioWorklet capture and resampling to 16 kHz PCM16, 100 ms chunks; independent input/output selectors; PCM and WAV playback; playback cancellation on urgency interruption.
- Streaming transcription and translation adapters, native translated audio by default, optional dedicated Gemini Flash TTS.
- Manual urgency flag plus acoustic intensity fallback. Experimental Gemini vocal attention classification is opt-in.
- Local JSON storage or Firestore session metadata plus `sessions/{id}/turns/{id}` subcollections. Browser transcript export.
- Docker, Cloud Run deployment, Secret Manager mounts, Firebase Hosting configuration, Firestore deny-by-default client rules, Cloud Build configuration.
- A standalone urgency recording probe, automated gateway/provider tests, browser rehearsal checks, and rehearsal guide.

## Architecture and the necessary spec correction

Browser PCM → one gateway socket → per-speaker transcription and translation connections → captions/audio → opposite speaker. Each live session uses four provider streams, or six with the optional Gemini urgency monitor. All provider credentials remain on the gateway.

Live Translate takes **audio input only**, so finalized transcript text cannot be its input as the initial brief proposed. The implementation fans PCM to Transcribe and Live Translate in parallel. Live Translate streams translated speech continuously; urgency interrupts client playback and requests expedited input finalization. With `SPEECH_MODE=tts`, native output audio is discarded and finalized translated text is synthesized by Flash TTS instead. This adds latency and must be measured before a live demo.

The installed SDK rejects `languageCodes` and does not serialize `translationConfig`. The core pipeline therefore uses the documented Live WebSocket wire protocol directly. Model IDs are configurable; provider access and quotas must be verified for your account.

API references checked during implementation:

- [Live Transcribe](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
- [Live Translate](https://ai.google.dev/gemini-api/docs/live-api/live-translate)
- [Flash TTS](https://ai.google.dev/gemini-api/docs/speech-generation)
- [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | unset | Required for live sessions |
| `STORE` | `local` | Set to `firestore` for cloud persistence |
| `DATA_DIR` | `data` | Local transcript directory |
| `GOOGLE_CLOUD_PROJECT` | your ADC project | Set to `spry-catcher-509805-u4` |
| `STAFF_PIN` | unset | Optional local gate; required by deployment script |
| `ALLOWED_ORIGINS` | localhost origins | Exact comma-separated browser origins |
| `URGENCY_MODE` | `acoustic` | `gemini` enables experimental model monitoring |
| `SPEECH_MODE` | `native` | `tts` uses dedicated TTS after finalized translation |
| `MAX_SESSIONS` | `20` | Maximum sockets per instance |

Acoustic mode measures sustained RMS intensity above 0.22 for 450 ms, with a five-second cooldown. It can raise **elevated**, never high; the clinician can set high manually. It does not infer emotions, diagnose symptoms, or claim validated urgency detection. Flags stay set until explicitly cleared. No speaking-rate classification is claimed.

## Deploy to `spry-catcher-509805-u4`

Install the official Google Cloud CLI, sign in with `gcloud auth login`, and ensure billing and deployment permissions are available. In Secret Manager create `gemini-api-key` and `pulseline-staff-pin`, each with an enabled secret version. Do not paste keys into source or shell history.

```powershell
./scripts/deploy.ps1 -ProjectId spry-catcher-509805-u4
```

The script enables required APIs, creates the service account, grants Firestore access and secret-level access, creates Firestore and Artifact Registry if absent, and source-deploys the Docker container with minimum one instance. Cloud Run serves the frontend and WebSocket from the same HTTPS origin. The service is publicly reachable; its WebSocket handshake requires the secret-mounted staff PIN. This is a prototype gate, not hospital identity management.

Optional Firebase Hosting:

```powershell
npm run build
./scripts/configure-hosting.ps1 -GatewayUrl https://YOUR-SERVICE.run.app
firebase deploy --only hosting,firestore:rules --project spry-catcher-509805-u4
```

Initialize Firebase for the existing GCP project if necessary. Hosting serves static assets and proxies `/api/**`; the browser opens WebSockets directly to Cloud Run. The deployment script allows both Firebase domains. Cloud Build YAML can be attached to a repository trigger after initial deployment; grant the build service account only the needed Artifact Registry, Run deployment, and service-account-user permissions.

Cloud Run websocket sessions are instance-local. If the connection drops, the session ends and its transcript is retained; the UI asks to start a new session. No automatic resumption or replay of medical audio is attempted.

## Tests

```powershell
npm test
npm run build
npm start
# In a second terminal; uses installed Microsoft Edge:
node scripts/browser-check.mjs
```

The tests exercise both language rehearsals, persistence, urgency and clearing, malformed traffic, handshake validation, origin restrictions, and provider wire framing. Browser tests verify both four-turn conversations, export, session ending, mobile overflow, and JavaScript errors. They do not establish live model accuracy or latency.

For the risk probe, provide consented calm, distressed, and background-noise recordings as raw 16kHz PCM16 mono files:

```powershell
npm run spike -- calm.pcm distressed.pcm noise.pcm
```

It reports model classifications and elapsed latency from connection start, including recording playback. Evaluate false positives and compare with manually labeled examples before enabling `URGENCY_MODE=gemini`.

## Verification status and limits

Local build, gateway tests, and browser rehearsal flows have been verified. No live key was configured during initial implementation; actual Gemini responses, account model access, TTS pronunciation, Firestore IAM, and cloud deployment remain unverified until credentials are supplied. No real recordings were provided, so the vocal-tone spike has not been run. End-to-end speech latency has not been measured.

This is a research prototype, not a clinically validated interpreter. It records transcripts locally or in Firestore and keeps current session turns in browser memory; audio is forwarded to the model and is not saved by the gateway. Before any real clinical use, establish consent, approved provider data handling, retention/deletion, institutional identity controls, clinical validation, and a qualified interpreter fallback. The repository supplies no clinical triage or diagnosis logic.
