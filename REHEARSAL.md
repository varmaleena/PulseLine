# Rehearsal and acceptance

1. Start a Hindi rehearsal. Doctor asks where it hurts. Patient reports chest pain. Doctor asks when it started. Patient reports difficulty breathing. The fourth scripted turn raises the attention signal and interrupts any queued speech.
2. Clear the signal, export the transcript, and end the session. Repeat with Telugu. Scripted speech is a fallback, not evidence of model performance.
3. Configure live access. Verify both directions independently with a native Hindi/Telugu speaker, including negation, medication names, quantities, and corrections. Confirm exact input device labels and output devices.
4. Test two physical microphones and headphones for bleed. Measure time from first speech and end of speech to first translated audio separately. Repeat at least five times under venue-like networking.
5. Run the recording spike with calm speech, distressed speech, and background noise. Retain acoustic/manual mode unless the model has demonstrated useful accuracy on those recordings.
6. Disconnect the network during speech. Confirm the UI reports failure, stops capture, retains exportable turns, and starts a clean new session after reconnecting.
7. Verify Firestore metadata ends correctly and finalized turns are stored. Verify Cloud Run has min-instances=1. Test the deployed app on the actual tablet over HTTPS.

Pitch: explain the communication gap, demonstrate the bilingual exchange and attention flag, state that attention signals are not diagnosis and this is not clinically validated, then describe only the components actually enabled. Default speech is native Live Translate audio; claim dedicated Flash TTS only when `SPEECH_MODE=tts` is enabled and tested.
