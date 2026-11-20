import test from 'node:test';
import assert from 'node:assert/strict';
import factory from 'ggwave';
import {sender,Receiver,envelope,unpack} from '../web/protocol.mjs';
import {modem} from '../web/modem.mjs';

test('entrada tardia, repetição e reparos por áudio real em PCM',async()=>{
  const api=await factory({print:()=>{}});api.disableLog();
  const tx=modem(api),rx=modem(api), receiver=new Receiver();
  const bytes=new TextEncoder().encode('Olá, Onda! 🌊');
  const source=await sender(envelope('message','',bytes));
  const bad=source.initial[0].slice();bad[60]^=1;
  await receiver.accept(bad);assert.equal(receiver.key,null);
  async function play(f){
    const wave=tx.encode(f);
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
test('arquivo, limites, checksum e pacote duplicado',async()=>{
  const bytes=Uint8Array.from({length:4096},(_,i)=>i);
  assert.throws(()=>envelope('file','x',new Uint8Array(4097)));
  const obj=envelope('file','ação.bin',bytes), tx=await sender(obj), rx=new Receiver();
  for(const f of tx.initial){await rx.accept(f);await rx.accept(f);}
  const item=unpack(rx.object);
  assert.equal(item.name,'ação.bin');assert.deepEqual(item.bytes,bytes);
  assert.throws(()=>unpack(new Uint8Array(8)));
});
