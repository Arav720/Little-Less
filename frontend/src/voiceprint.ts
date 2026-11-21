// Records a short voice sample and converts it to what Agora's speaker lock needs:
// raw PCM, 16 kHz, 16-bit, mono.
const TARGET_RATE = 16_000;

export type Recording = { stop: () => void; done: Promise<ArrayBuffer> };

export function recordVoice(seconds: number, onProgress: (elapsed: number, level: number) => void): Recording {
  let stopNow = () => {};
  const done = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // Ask the browser to resample to 16 kHz for us; fall back to manual resampling if it won't.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      ctx = new AudioContext();
    }
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    let samples = 0;
    const total = seconds * ctx.sampleRate;

    await new Promise<void>((resolve) => {
      stopNow = resolve;
      proc.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(data);
        samples += data.length;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        onProgress(Math.min(seconds, samples / ctx.sampleRate), Math.sqrt(sum / data.length));
        if (samples >= total) resolve();
      };
      source.connect(proc);
      proc.connect(ctx.destination); // ScriptProcessor only runs while connected
    });

    proc.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const rate = ctx.sampleRate;
    await ctx.close();

    const all = new Float32Array(samples);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.length;
    }
    const mono16k = rate === TARGET_RATE ? all : resample(all, rate, TARGET_RATE);
    const pcm = new Int16Array(mono16k.length);
    for (let i = 0; i < mono16k.length; i++) {
      const s = Math.max(-1, Math.min(1, mono16k[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm.buffer;
  })();
  return { stop: () => stopNow(), done };
}

function resample(input: Float32Array, from: number, to: number) {
  const out = new Float32Array(Math.floor((input.length * to) / from));
  const ratio = from / to;
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}
