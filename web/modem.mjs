export const RATE = 48000;
export const GAP = 0.16;

export function modem(api, rate = RATE) {
  const p = api.getDefaultParameters();
  p.sampleRateInp = rate;
  p.sampleRateOut = RATE;
  p.payloadLength = -1;
  p.sampleFormatInp = p.sampleFormatOut = api.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
  const id = api.init(p);
  if (id < 0) throw Error('Não foi possível iniciar o modem de áudio.');
  return {
    encode(frame) {
      const base64 = btoa(String.fromCharCode(...frame));
      const wave = api.encode(id, base64, api.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, 28);
      if (!wave.length) throw Error('O modem não gerou áudio.');
      return new Float32Array(new Uint8Array(wave).buffer);
    },
    decode(samples) {
      const pcm = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
      const result = api.decode(id, pcm);
      if (result.length !== 136) return null;
      const str = String.fromCharCode(...result);
      if (!/^[A-Za-z0-9+/]{134}==$/.test(str)) return null;
      return Uint8Array.from(atob(str), c => c.charCodeAt(0));
    },
    close() { api.free(id); }
  };
}
