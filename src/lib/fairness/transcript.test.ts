import {createEventSigner, generateSigningIdentity} from "./eventSigning";
import {TranscriptRecorder, verifyTranscript} from "./transcript";

describe('transcript recorder', () => {
  test('records signed events as a verifiable hash chain', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity);
    const recorder = new TranscriptRecorder();

    const signed = await signer.sign({
      sender: identity.peerId,
      scope: 'public',
      payload: {
        type: 'newRound',
        round: 1,
      },
    });

    await recorder.append({
      transportSender: identity.peerId,
      scope: 'public',
      wireEvent: signed,
    });

    await expect(verifyTranscript(recorder.snapshot())).resolves.toMatchObject({
      ok: true,
    });
  });

  test('detects transcript entry tampering', async () => {
    const recorder = new TranscriptRecorder();

    await recorder.append({
      transportSender: 'peer-a',
      scope: 'public',
      wireEvent: {
        type: 'action/fold',
        round: 1,
      },
    });

    const tampered = recorder.snapshot();
    tampered.entries[0] = {
      ...tampered.entries[0],
      payloadHash: 'sha256:fake',
    };

    await expect(verifyTranscript(tampered)).resolves.toMatchObject({
      ok: false,
      failedIndex: 0,
    });
  });

  test('serializes concurrent appends into one hash chain', async () => {
    const recorder = new TranscriptRecorder();

    await Promise.all([
      recorder.append({
        transportSender: 'peer-a',
        scope: 'public',
        wireEvent: { type: 'event-a' },
      }),
      recorder.append({
        transportSender: 'peer-b',
        scope: 'public',
        wireEvent: { type: 'event-b' },
      }),
    ]);

    const snapshot = recorder.snapshot();

    expect(snapshot.entries.map(entry => entry.index)).toEqual([0, 1]);
    await expect(verifyTranscript(snapshot)).resolves.toMatchObject({
      ok: true,
    });
  });
});
