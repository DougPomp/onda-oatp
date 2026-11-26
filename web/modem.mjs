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
    encode(frame, profile = 'normal') {
      const protocols = api.ProtocolId;
      const protocol = {normal: protocols.GGWAVE_PROTOCOL_AUDIBLE_NORMAL,
        fast: protocols.GGWAVE_PROTOCOL_AUDIBLE_FAST, fastest: protocols.GGWAVE_PROTOCOL_AUDIBLE_FASTEST,
        high: protocols.GGWAVE_PROTOCOL_ULTRASOUND_NORMAL}[profile];
      if (!protocol) throw Error('Perfil de áudio desconhecido.');
      const wave = api.encode(id, frame, protocol, 28);
      if (!wave.length) throw Error('O modem não gerou áudio.');
      return new Float32Array(new Uint8Array(wave).buffer);
    },
    decode(samples) {
      const pcm = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
      const result = api.decode(id, pcm);
      // Copy the WASM view before the next decode overwrites it.
      if (result.length === 100) return new Uint8Array(result);
      if (result.length !== 136) return null;
      const str = String.fromCharCode(...result);
      if (!/^[A-Za-z0-9+/]{134}==$/.test(str)) return null;
      return Uint8Array.from(atob(str), c => c.charCodeAt(0));
    },
    close() { api.free(id); }
  };
}
