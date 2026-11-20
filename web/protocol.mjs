import {utf8,digest,concat,addScaled,coefficients,insert} from './algebra.mjs';

export const LIMIT = 4096;
const MAX_OBJECT = LIMIT + 263;
const same = (a,b) => a.length === b.length && a.every((v,i)=>v === b[i]);
const view = a => new DataView(a.buffer,a.byteOffset,a.byteLength);
const params = Uint8Array.of(1,1,0,64,0,64,0,0);
const idKey = raw => digest(concat(utf8.encode('OATP-ID-v1\0'),raw));
const ks = len => Array.from({length:Math.ceil(len/4096)},(_,g)=>Math.min(64,Math.ceil(len/64)-g*64));
const budget = k => k + Math.ceil(k/2);
const utf = new TextDecoder('utf-8',{fatal:true});

export function envelope(kind,name,bytes) {
  if (!['message','file'].includes(kind) || bytes.length>LIMIT) throw Error('O limite é de 4 KiB por envio.');
  const filename = utf8.encode(kind==='file' ? name : '');
  if (filename.length>255) throw Error('Use um nome de arquivo mais curto.');
  return concat(utf8.encode('ONDA'),Uint8Array.of(1,kind==='file'?1:0,filename.length),filename,bytes);
}
export function unpack(data) {
  if(data.length<7 || !same(data.subarray(0,4),utf8.encode('ONDA')) || data[4]!==1 || data[5]>1 ||
     (!data[5] && data[6]) || data.length<7+data[6]) throw Error('Formato de conteúdo desconhecido.');
  const name=utf.decode(data.subarray(7,7+data[6])).replace(/[\\/\x00-\x1f\x7f]/g,'_') || 'arquivo.bin';
  const bytes=data.slice(7+data[6]);
  if(bytes.length>LIMIT) throw Error('Arquivo maior que 4 KiB.');
  return data[5] ? {kind:'file',name,bytes} : {kind:'message',text:utf.decode(bytes),bytes};
}
function crc(bytes) {
  let v=0xffffffff;
  for(const byte of bytes){v^=byte;for(let bit=0;bit<8;bit++) v=(v>>>1)^((v&1)?0x82f63b78:0);}
  return (~v)>>>0;
}
function pack(key,type,g,esi,payload) {
  const f=new Uint8Array(100), d=view(f);
  f.set([79,65,84,80,0,1,type,0]);f.set(key.subarray(0,16),8);
  d.setUint32(24,g);d.setUint32(28,esi);f.set(payload,32);d.setUint32(96,crc(f.subarray(0,96)));
  return f;
}
async function vector(key,g,esi,k) {
  if(esi>=k) return coefficients(key,g,esi,k);
  const row=new Uint8Array(k);row[esi]=1;return row;
}
export async function sender(data,tag=new Uint8Array(16)) {
  const raw=new Uint8Array(64);
  raw.set(params);view(raw).setBigUint64(8,BigInt(data.length));raw.set(await digest(data),16);raw.set(tag,48);
  const key=await idKey(raw), sizes=ks(data.length), limits=sizes.map(budget);
  const manifest=pack(key,1,0xffffffff,0,raw);
  async function symbol(g,esi) {
    const a=await vector(key,g,esi,sizes[g]), payload=new Uint8Array(64);
    a.forEach((factor,i)=>{const pos=g*4096+i*64;addScaled(payload,data.subarray(pos,pos+64),factor)});
    return pack(key,2,g,esi,payload);
  }
  const schedule=[manifest];
  let n=0;
  for(let esi=0;esi<Math.max(0,...limits);esi++) for(const [g,limit] of limits.entries()) {
    if(esi>=limit) continue;
    schedule.push(await symbol(g,esi));
    if(++n%8===0) schedule.push(manifest);
  }
  if(n%8) schedule.push(manifest);
  let position=0;
  return {initial:schedule,async repairs(){
    const batch=[manifest];
    if(!sizes.length)return batch;
    for(let i=0;i<8;i++){
      const round=Math.floor(position/sizes.length);
      const g=(position%sizes.length+round)%sizes.length;
      if(limits[g]+round>0xffffffff) throw Error('Sequência de reparos esgotada.');
      batch.push(await symbol(g,limits[g]+round));position++;
    }
    batch.push(manifest);return batch;
  }};
}
export class Receiver {
  key=null; groups=[]; rank=0; total=0; packets=0; object=null; failed=false;
  async accept(f) {
    if(this.failed || this.object || f.length!==100)return;
    const d=view(f), type=f[6], g=d.getUint32(24), esi=d.getUint32(28);
    if(!same(f.subarray(0,6),Uint8Array.of(79,65,84,80,0,1)) || f[7] || d.getUint32(96)!==crc(f.subarray(0,96)))return;
    const id=f.subarray(8,24), payload=f.slice(32,96);
    if(this.key && !same(id,this.key.subarray(0,16)))return;
    if(type===1){
      if(g!==0xffffffff || esi!==0 || !same(payload.subarray(0,8),params))return;
      const length=view(payload).getBigUint64(8);
      if(length>BigInt(MAX_OBJECT))return;
      const key=await idKey(payload);
      if(!same(key.subarray(0,16),id))return;
      if(!length && !same(await digest(new Uint8Array()),payload.subarray(16,48)))return;
      if(this.key && !same(key,this.key)){this.failed=true;throw Error('Manifestos conflitantes.');}
      if(!this.key){
        this.key=key;this.length=Number(length);this.hash=payload.slice(16,48);
        this.groups=ks(this.length).map(k=>Array(k));this.total=Math.ceil(this.length/64);
      }
    }else if(type===2 && this.key && g<this.groups.length){
      const rows=this.groups[g], a=await vector(this.key,g,esi,rows.length);
      try{if(insert(rows,concat(a,payload))) this.rank++;}
      catch(error){this.failed=true;throw error;}
    }else return;
    this.packets++;
    if(this.total!==this.rank)return;
    const padded=concat(...this.groups.flatMap(rows=>rows.map(row=>row.subarray(rows.length))));
    const bytes=padded.slice(0,this.length);
    if(padded.subarray(this.length).some(Boolean) || !same(await digest(bytes),this.hash)){
      this.failed=true;throw Error('Falha de integridade. Inicie uma nova recepção.');
    }
    this.object=bytes;
  }
}
