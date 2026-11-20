import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import QRCode from 'qrcode';

await mkdir('dist/vendor',{recursive:true});
await cp('web','dist',{recursive:true});
await cp('node_modules/ggwave/ggwave.js','dist/vendor/ggwave.js');
await cp('painel','dist/laboratorio',{recursive:true});
const url='https://dougpomp.github.io/onda-oatp/';
await writeFile('dist/qr.svg',await QRCode.toString(url,{type:'svg',margin:4,width:200}));
const notices=await Promise.all(['LICENSE','licenses/ggwave.txt','licenses/reed-solomon.txt','licenses/fft.txt','node_modules/qrcode/license']
  .map(async path=>path+'\n\n'+await readFile(path,'utf8')));
await writeFile('dist/NOTICE.txt',notices.join('\n\n'));
await writeFile('dist/.nojekyll','');
