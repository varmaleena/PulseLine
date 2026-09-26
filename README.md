# PulseLine

A tablet-first, bilingual ER interpreter prototype: English ⇄ Hindi or Telugu, separate speaker inputs, streaming captions and audio, attention flags, and session transcripts.

See [BUILD_STATUS.md](BUILD_STATUS.md) for the phase-by-phase audit, latest verified checks, and remaining external setup. After privately configuring a key, run `npm run verify:live -- --tts` to check provider access for both language pairs.

## Run locally

Requires Node.js 22+.

```powershell
npm ci
npm run build
npm start
```

Open http://localhost:8080. Choose **Guided rehearsal**, start a session, and play the four turns. Rehearsal is explicitly scripted and does not call Gemini. Browser voice availability varies; Hindi and Telugu voices may need installing in the operating system.

For live interpretation, copy `.env.example` to `.env`, set `GEMINI_API_KEY`, and restart the server. The key stays server-side. Choose **Live microphone** and press **Start session** in the persistent top bar. Allow microphone access: patient listening starts automatically. Use **Speak as doctor / patient** directly in the live conversation panel to switch a shared microphone. Separate input devices can be selected in the microphone settings. Use headphones to reduce feedback. Microphone access requires localhost or HTTPS.

The **Heard** fields show recognized speech as it arrives; **Translation** fields show the other language. Completed phrases appear in **Conversation history** and are included in **Export**. **End session** stays in the top bar while scrolling and stops both microphones. **How it works** opens the annotated step-by-step guide. Audio delivery status and a no-transcript timeout help distinguish microphone issues from provider issues.

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

The installed SDK rejects `languageCodes` and does not serialize `translationConfig`. The core pipeline therefore uses the Live WebSocket wire protocol directly. Live testing confirms transcription configuration belongs at setup level, with translation configuration inside generationConfig. Model IDs are configurable; provider access and quotas must be verified for your account.

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

Acoustic monitoring automatically raises **elevated** after sustained RMS intensity above 0.22 for 450 ms, with a five-second cooldown. A separate narrow phrase detector raises **high attention** for explicit first-person reports of breathing difficulty in the patient's English translation, including "I cannot breathe" and "It's hard for me to breathe." It excludes simple negative statements and questions, but is not a general symptom or severity classifier: paraphrases can be missed and complex negation can still cause false positives. The UI states the trigger and asks for confirmation. Manual flag/clear controls remain available. High flags persist until cleared. Neither signal diagnoses symptoms or measures clinical severity; no validated tone or speaking-rate classification is claimed.

Live Translate does not consistently emit `turnComplete`. The gateway therefore also finalizes translated phrases after 1.6 seconds without new transcript text. Streaming captions and native audio do not wait for that timer. Session end flushes translated text already received; it does not wait for unreceived provider output.

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

With a key configured and the local server running, `npm run test:live` generates synthetic Hindi, Telugu, and English speech and feeds WAV recordings through Chromium's fake microphone. It checks the actual AudioWorklet → gateway → Gemini → captions/history/audio path, including browser audio scheduling and automatic breathing-distress flags. Default test URL is `http://localhost:8082`; set `TEST_BASE_URL` for another port. Recordings and screenshots stay in ignored `test-results/live/`. This consumes provider quota and is a functional smoke test, not clinical validation.

For the risk probe, provide consented calm, distressed, and background-noise recordings as raw 16kHz PCM16 mono files:

```powershell
npm run spike -- calm.pcm distressed.pcm noise.pcm
```

It reports model classifications and elapsed latency from connection start, including recording playback. Evaluate false positives and compare with manually labeled examples before enabling `URGENCY_MODE=gemini`.

## Verification status and limits

Local build, all 17 regression tests, and browser rehearsal flows have been verified. Synthetic-audio tests against Gemini now pass in all four directions: Hindi → English, Telugu → English, English → Hindi, and English → Telugu. They exercise microphone capture, transcription, translation, conversation history, returned audio, browser playback scheduling, and automatic flags for the two patient distress examples. Physical microphone behavior, broad translation accuracy, pronunciation quality, Firestore IAM, and cloud deployment remain unverified. No consented human recordings were provided for the vocal-tone spike. These checks do not establish a reliable end-to-end latency target or clinical accuracy.

This is a research prototype, not a clinically validated interpreter. It records transcripts locally or in Firestore and keeps current session turns in browser memory; audio is forwarded to the model and is not saved by the gateway. Before any real clinical use, establish consent, approved provider data handling, retention/deletion, institutional identity controls, clinical validation, and a qualified interpreter fallback. The repository supplies no clinical triage or diagnosis logic.
