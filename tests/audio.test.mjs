import test from 'node:test';
import assert from 'node:assert/strict';
import factory from 'ggwave';
import {sender,Receiver,AudioReceiver,envelope,unpack} from '../web/protocol.mjs';
import {modem} from '../web/modem.mjs';

for(const profile of ['normal','high']) test('entrada tardia, repetição e reparos em PCM: '+profile,async()=>{
  const api=await factory({print:()=>{}});api.disableLog();
  const tx=modem(api),rx=modem(api), receiver=new Receiver();
  const bytes=new TextEncoder().encode('Olá, Onda! 🌊');
  const source=await sender(envelope('message','',bytes));
  const bad=source.initial[0].slice();bad[60]^=1;
  await receiver.accept(bad);assert.equal(receiver.key,null);
  async function play(f){
    const wave=tx.encode(f,profile);
    let found=0;
    for(let i=0;i<wave.length+8192;i+=1024){
      const input=new Float32Array(1024);input.set(wave.subarray(i,i+1024));
      const result=rx.decode(input);
      if(result){found++;assert.deepEqual(result,f);await receiver.accept(result);}
    }
    assert.equal(found,1);
  }
  try{
    await play(source.initial[1]);assert.equal(receiver.key,null);
    const repairs=await source.repairs();
    await play(repairs[0]);await play(repairs[0]);assert.equal(receiver.rank,0);
    await play(repairs[1]);
    assert.equal(unpack(receiver.object).text,'Olá, Onda! 🌊');
  }finally{tx.close();rx.close();}
});

test('perfis audíveis, compatibilidade e recuperação após interferência no início',async()=>{
  const api=await factory({print:()=>{}});api.disableLog();
  const tx=modem(api), rx=modem(api), text='Olá, Onda!';
  const source=await sender(envelope('message','',new TextEncoder().encode(text)));
  function demodulate(wave){
    const packets=[];
    for(let i=0;i<wave.length+8192;i+=1024){
      const chunk=new Float32Array(1024);chunk.set(wave.subarray(i,i+1024));
      const packet=rx.decode(chunk);if(packet)packets.push(packet);
    }
    return packets;
  }
  try{
    const lengths=[];
    for(const profile of ['normal','fast','fastest']){
      const wave=tx.encode(source.initial[1],profile);
      lengths.push(wave.length);
      for(let i=0;i<wave.length;i++){
        const t=i/48000;
        // Controlled, low-frequency harmonic interference with a syllabic envelope.
        wave[i]+=0.07*Math.sin(Math.PI*4*t)**2*(Math.sin(2*Math.PI*190*t)+0.4*Math.sin(2*Math.PI*570*t));
      }
      assert.deepEqual(demodulate(wave),[source.initial[1]]);
    }
    assert.ok(lengths[0]>lengths[1] && lengths[1]>lengths[2]);
    const receiver=new AudioReceiver();
    const masked=tx.encode(source.initial[0]);
    let state=917;
    for(let i=0;i<48000;i++){
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      masked[i]=state/0x100000000-0.5;
    }
    assert.deepEqual(demodulate(masked),[]);
    for(const frame of source.initial.slice(1)){
      for(const packet of demodulate(tx.encode(frame)))await receiver.accept(packet);
    }
    assert.equal(unpack(receiver.object).text,text);
    const rescue=new AudioReceiver();
    // Both data frames are erased; only manifests and the automatic extra repair arrive.
    for(const frame of [source.initial[0],source.initial.at(-1),...await source.extraRound()]){
      for(const packet of demodulate(tx.encode(frame)))await rescue.accept(packet);
    }
    assert.equal(unpack(rescue.object).text,text);
    const legacy=api.init(api.getDefaultParameters());
    try{
      const wave=api.encode(legacy,btoa(String.fromCharCode(...source.initial[0])),api.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL,28);
      assert.deepEqual(demodulate(new Float32Array(new Uint8Array(wave).buffer)),[source.initial[0]]);
    }finally{api.free(legacy);}
  }finally{tx.close();rx.close();}
});
test('arquivo, limites, checksum e pacote duplicado',async()=>{
  const bytes=Uint8Array.from({length:4096},(_,i)=>i);
  assert.throws(()=>envelope('file','x',new Uint8Array(4097)));
  const obj=envelope('file','ação.bin',bytes), tx=await sender(obj), rx=new Receiver();
  for(const f of tx.initial){await rx.accept(f);await rx.accept(f);}
  const item=unpack(rx.object);
  assert.equal(item.name,'ação.bin');assert.deepEqual(item.bytes,bytes);
  assert.throws(()=>unpack(new Uint8Array(8)));
});
