import {envelope, unpack, sender, AudioReceiver, LIMIT} from './protocol.mjs';
import {modem, RATE, GAP} from './modem.mjs';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('pt-BR');
let api, tab='send', kind='message', job=null, prepared=null, receiver=new AudioReceiver(), outputUrl;
const frameTimes={};
const canvas=$('scope'), pen=canvas.getContext('2d');
function draw(samples, color='#82f2c3'){
  pen.clearRect(0,0,canvas.width,canvas.height);
  pen.strokeStyle=color;pen.lineWidth=2;pen.beginPath();
  for(let i=0;i<canvas.width;i++){
    const value=samples?.[Math.floor(i*samples.length/canvas.width)] || 0;
    const y=canvas.height*(0.5-Math.max(-1,Math.min(1,value*2))*0.4);
    if(i)pen.lineTo(i,y);else pen.moveTo(i,y);
  }
  pen.stroke();
}
function status(title,detail='',fraction=0){
  $('status').textContent=title;$('detail').textContent=detail;
  $('bar').style.width=100*Math.max(0,Math.min(1,fraction))+'%';
}
function controls(){
  for(const id of ['sendTab','recvTab','msg','bin','text','file','profile']) $(id).disabled=!!job;
  $('sendPanel').hidden=tab!=='send';$('recvPanel').hidden=tab!=='recv';
  $('sendTab').setAttribute('aria-pressed',tab==='send');$('recvTab').setAttribute('aria-pressed',tab==='recv');
  $('msg').setAttribute('aria-pressed',kind==='message');$('bin').setAttribute('aria-pressed',kind==='file');
  $('picker').hidden=kind!=='file';$('text').hidden=kind!=='message';
  $('repair').hidden=!!job || !prepared;
  $('forget').hidden=!!job || !receiver.key || receiver.failed || !!receiver.object;
  $('stop').hidden=!job;$('stop').textContent=tab==='recv'?'Parar de ouvir':'Parar transmissão';
  $('listen').disabled=!!job || !api;$('transmit').disabled=!!job || !api || !inputSize().valid;
  $('led').classList.toggle('on',!!job);$('scopeLabel').textContent=job?(tab==='send'?'TRANSMISSÃO':'MICROFONE'):'EM ESPERA';
}
function inputSize(){
  const file=$('file').files[0], isText=kind==='message';
  const bytes=isText?new TextEncoder().encode($('text').value).length:(file?.size || 0);
  const nameBytes=isText?0:new TextEncoder().encode(file?.name || '').length;
  return {bytes,nameBytes,valid:(isText?bytes>0:!!file) && bytes<=LIMIT && nameBytes<=255};
}
function preview(){
  const {bytes,nameBytes,valid}=inputSize();
  $('size').textContent=fmt(bytes)+' / 4.096 bytes';
  let n=Math.ceil((7+nameBytes+bytes)/64), symbols=0;
  while(n>0){const k=Math.min(n,64);symbols+=k+Math.ceil(k/2);n-=k;}
  const profile=$('profile').value;
  $('highHint').hidden=profile!=='high';
  const frameTime=frameTimes[profile];
  const extra=profile==='normal'?Math.ceil((7+nameBytes+bytes)/4096):0;
  const count=1+symbols+Math.ceil(symbols/8)+extra;
  const seconds=Math.ceil(count*(frameTime+GAP)-GAP);
  $('estimate').textContent=!valid?(bytes>LIMIT?'Limite excedido':'Selecione um conteúdo válido'):
    frameTime?'Inicial ≈ '+(seconds>=60?Math.floor(seconds/60)+' min ':'')+(seconds%60)+' s':'Calculando duração…';
  controls();
}
function inputChanged(){prepared=null;preview();if(!job && api)status('Pronto para transmitir');}
$('text').oninput=$('file').onchange=inputChanged;
$('profile').onchange=preview;
for(const [id,value] of [['msg','message'],['bin','file']]) $(id).onclick=()=>{kind=value;inputChanged();};
$('sendTab').onclick=()=>{tab='send';controls();status('Pronto para transmitir');};
$('recvTab').onclick=()=>{tab='recv';controls();startReceive();};
$('share').onclick=()=>$('dialog').showModal();
function clearOutput(){
  $('output').hidden=true;$('content').textContent='';$('copy').hidden=$('download').hidden=true;
  if(outputUrl)URL.revokeObjectURL(outputUrl);
  outputUrl=null;$('download').removeAttribute('href');
}
function end(j){
  if(!j || job!==j)return;
  job=null;
  if(j.node){j.node.port.onmessage=null;j.node.disconnect();}
  j.stream?.getTracks().forEach(t=>t.stop());
  if(j.source){try{j.source.stop()}catch{} j.source.disconnect();}
  if(j.raf)cancelAnimationFrame(j.raf);
  if(j.ctx){j.ctx.onstatechange=null;j.ctx.close().catch(()=>{});}
  j.cancel?.();j.mod?.close();draw();controls();
}
function interrupt(j){
  if(job!==j)return;
  end(j);
  status('Sessão interrompida',tab==='recv'?'Toque em Receber pelo microfone para retomar.':'Toque em Transmitir para recomeçar ou continue com reparos.');
}
function start(){
  if(job || !api)return null;
  const ctx=new AudioContext(), j={ctx};job=j;controls();
  j.ready=ctx.resume();
  ctx.onstatechange=()=>{if(ctx.state==='interrupted' || ctx.state==='suspended')interrupt(j);};
  return j;
}
$('stop').onclick=()=>interrupt(job);
window.addEventListener('pagehide',()=>{if(job)interrupt(job);});
function play(j,pcm){
  return new Promise(resolve=>{
    const ctx=j.ctx, buf=ctx.createBuffer(1,pcm.length,RATE);buf.copyToChannel(pcm,0);
    const source=ctx.createBufferSource();source.buffer=buf;source.connect(ctx.destination);
    j.source=source;j.cancel=resolve;
    const startTime=ctx.currentTime;
    function redraw(){
      if(job!==j)return;
      const pos=Math.max(0,Math.floor((ctx.currentTime-startTime)*RATE));
      draw(pcm.subarray(pos,pos+1024));j.raf=requestAnimationFrame(redraw);
    }
    source.onended=()=>{cancelAnimationFrame(j.raf);source.disconnect();resolve();};
    source.start();redraw();
  });
}
async function transmit(repair){
  let j;
  try{
    j=start();if(!j)return;
    await j.ready;if(job!==j)return;
    status('Preparando transmissão…');
    j.mod=modem(api);
    if(!repair){
      const file=$('file').files[0];
      const bytes=kind==='message'?new TextEncoder().encode($('text').value):new Uint8Array(await file.arrayBuffer());
      const tx=await sender(envelope(kind,file?.name || '',bytes),crypto.getRandomValues(new Uint8Array(16)));
      if(job!==j)return;prepared=tx;
    }
    const profile=$('profile').value;
    const frames=repair?await prepared.repairs():prepared.initial.slice();
    if(!repair && profile==='normal')frames.push(...await prepared.extraRound());
    for(let i=0;i<frames.length;i++){
      if(job!==j)return;
      status(repair?'Transmitindo reparos':'Transmitindo pelo alto-falante','Quadro '+(i+1)+' de '+frames.length,i/frames.length);
      await play(j,j.mod.encode(frames[i],profile));
      if(job!==j)return;
      if(i+1<frames.length)await new Promise(resolve=>setTimeout(resolve,GAP*1000));
    }
    if(job!==j)return;
    end(j);status('Sequência reproduzida','Confira o outro aparelho. Se a recepção estiver incompleta, continue com reparos.',1);
  }catch(e){if(!j || job===j){end(j);status('Falha no envio',e.message);}}
}
$('transmit').onclick=()=>transmit(false);$('repair').onclick=()=>transmit(true);
function showResult(item){
  clearOutput();$('output').hidden=false;
  if(item.kind==='message'){
    $('content').textContent=item.text;$('copy').hidden=false;
  }else{
    $('content').textContent=item.name+' · '+fmt(item.bytes.length)+' bytes';
    outputUrl=URL.createObjectURL(new Blob([item.bytes],{type:'application/octet-stream'}));
    Object.assign($('download'),{href:outputUrl,download:item.name,hidden:false});
  }
}
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('content').textContent);status('Mensagem copiada','',1);}
  catch{status('Selecione a mensagem para copiar.','',1);}};
async function startReceive(){
  let j;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Abra a página HTTPS no Safari ou Chrome para ativar o microfone.');
    j=start();if(!j)return;
    if(receiver.failed || receiver.object)receiver=new AudioReceiver();
    clearOutput();status('Aguardando microfone…');
    const permission=navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const stream=await permission;
    if(job!==j){stream.getTracks().forEach(t=>t.stop());return;}
    j.stream=stream;await j.ready;if(job!==j)return;
    await j.ctx.audioWorklet.addModule(new URL('./capture.js',import.meta.url));
    if(job!==j)return;
    j.mod=modem(api,j.ctx.sampleRate);
    const mic=j.ctx.createMediaStreamSource(stream), node=new AudioWorkletNode(j.ctx,'onda-capture');
    const silent=j.ctx.createGain();silent.gain.value=0;
    mic.connect(node).connect(silent).connect(j.ctx.destination);j.node=node;
    stream.getAudioTracks()[0].onended=()=>interrupt(j);
    let pending=Promise.resolve(),lastDraw=0;
    status('Ouvindo','Aguardando um manifesto. Agora toque em Transmitir no outro aparelho.');
    node.port.onmessage=({data})=>{
      if(job!==j)return;
      if(performance.now()-lastDraw>55){draw(data,'#ffd28c');lastDraw=performance.now();}
      try{
        const frame=j.mod.decode(data);
        if(frame)pending=pending.then(async()=>{
          if(job!==j)return;
          await receiver.accept(frame);if(job!==j)return;
          if(!receiver.key){
            if(receiver.pending.length)status('Símbolos guardados','Aguardando a próxima identificação da transferência.');
            return;
          }
          if(receiver.object){
            const item=unpack(receiver.object);end(j);showResult(item);
            status('Conteúdo recebido e verificado','Integridade confirmada com SHA-256.',1);
          }else status('Recebendo quadros',receiver.rank+' de '+receiver.total+' símbolos independentes · '+receiver.packets+' quadros válidos',receiver.rank/receiver.total);
        }).catch(e=>{if(job===j){end(j);status('Recepção interrompida',e.message);}});
      }catch(e){end(j);status('Falha ao decodificar áudio',e.message);}
    };
  }catch(e){if(!j || job===j){end(j);status(e.name==='NotAllowedError'?'Microfone não autorizado':'Microfone indisponível',
    e.name==='NotAllowedError'?'Permita o microfone nas configurações deste site e toque em Receber pelo microfone.':e.message);}}
}
$('listen').onclick=startReceive;
$('forget').onclick=()=>{
  receiver=new AudioReceiver();controls();status('Pronto para receber','Toque em Receber pelo microfone para iniciar outra transferência.');
};
draw();preview();
try{
  api=await window.ggwave_factory({print:()=>{}});api.disableLog();
  const probe=modem(api);
  try{for(const option of $('profile').options)frameTimes[option.value]=probe.encode(new Uint8Array(100),option.value).length/RATE;}
  finally{probe.close();}
  preview();status('Pronto para transmitir','O áudio será reproduzido neste aparelho.');
}catch(e){api=null;controls();status('Modem indisponível',e.message);}
