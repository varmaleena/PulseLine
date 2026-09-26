# PulseLine implementation audit — 26 September 2026

## Local live verification follow-up

The key is now configured privately. Both Hindi and Telugu live stream setups and dedicated TTS requests passed against Gemini. Live testing revealed that transcription configuration must be at the setup level; the adapter and regression test were corrected. All 14 tests and the build pass, and both scripted browser flows pass. The updated local server uses port 8082 because 8080 was occupied. Real microphone interpretation quality, full speech-to-playback latency, and cloud deployment still require verification. The original audit below records the earlier baseline.

The repository already contained substantial implementation for phases 1–8.
It was a locally working rehearsal prototype, not a verified deployed live interpreter.
An overall percentage would conflate implemented adapters with proven provider behavior.

| Spec phase | Current evidence | Remaining acceptance work |
| --- | --- | --- |
| 0: vocal urgency risk spike | Recording probe implemented; acoustic/manual fallback selected | Run consented calm, distressed, and noise recordings; assess false positives and response times |
| 1: gateway and capture | Validated WebSocket gateway, separate inputs, AudioWorklet PCM capture | Test physical microphones on the target tablet |
| 2: transcription | Streaming adapter and partial/final caption handling implemented | Verify actual model access and speech recognition |
| 3: translation | Both fixed language pairs, incremental captions, mocked stream regression tests | Verify unscripted Hindi and Telugu conversations |
| 4: speech | Native streamed audio and optional dedicated Flash TTS implemented | Verify pronunciation, output routing, and speech-to-playback latency |
| 5: urgency | Acoustic intensity, manual flags, experimental model monitor, interruption handling | Rehearse five times on real audio; model urgency remains experimental |
| 6: persistence | Local JSON tested; Firestore session/turn writer implemented | Verify Firestore IAM and writes in the target project |
| 7: deployment | Docker, Cloud Run, Secret Manager, Firebase and Cloud Build configurations present | Deploy to confirmed project `spry-catcher-509805-u4` and verify HTTPS/WebSocket access |
| 8: demo polish | Both scripted flows, urgency indicator, transcript export, responsive UI tested | Actual tablet/venue rehearsal and backup demo recording |

## Completed in this audit

- Prevented session startup from announcing an active session after disconnect; concurrent end calls now wait for the same persistence operation.
- Provider failures close sibling streams and end the browser session instead of leaving a misleading live connection.
- Preserved interrupted partial translations as provisional turns and prevented text from leaking into the next turn.
- Converted raw urgency system instructions into the Live protocol Content structure.
- Separated speech synthesis from persistence so a slow TTS call cannot delay saving later turns; obsolete queued TTS is suppressed after a manual/model high flag, and requests are aborted on session close.
- Kept export language bound to its session, aggregated both speakers' attention flags, and reset session UI state on restart.
- Added structured turn latency logs without transcript text. This measures first detected input to completed translated text, not browser playback latency.
- Added provider/lifecycle regression tests and an account-access smoke test.
- Fixed browser QA output paths to remain within the workspace and verified exported language after changing the selector.

## Verification

- `npm test`: 14 tests passed.
- `npm run build`: passed.
- Browser QA against the updated server on port 8081: Hindi and Telugu four-turn flows, urgency/clear, export, session end, mobile overflow, and absence of JavaScript errors passed.
- Screenshots: `test-results/qa/`.
- Live model calls, Firestore, cloud deployment, physical audio, and real latency have **not** been verified.

## External setup required to finish

At audit time there was no local `.env`, no `GEMINI_API_KEY` environment variable, and neither `gcloud` nor `firebase` was available on PATH or the checked standard Cloud SDK locations.

1. Configure the Gemini key privately in `.env` using `.env.example`.
2. Run `npm run verify:live -- --tts` to check both language stream setups and dedicated speech generation. This consumes provider quota and is only an access smoke test.
3. Install/sign in to Google Cloud CLI. Create the `gemini-api-key` and `pulseline-staff-pin` secrets with enabled versions in `spry-catcher-509805-u4`.
4. Run `./scripts/deploy.ps1 -ProjectId spry-catcher-509805-u4` as documented in README. Minimum one Cloud Run instance incurs ongoing cloud charges.
5. If separate Firebase Hosting is desired, install/sign in to Firebase CLI and follow README's hosting commands.
6. Run the real-audio risk probe and complete `REHEARSAL.md` on target hardware and venue Wi-Fi.

The existing architecture correctly adapts the brief to Google's audio-input Live Translate API, rather than feeding finalized text into it. Official references: [Live Translate](https://ai.google.dev/gemini-api/docs/live-api/live-translate), [Live Transcribe](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe), [TTS](https://ai.google.dev/gemini-api/docs/speech-generation).
