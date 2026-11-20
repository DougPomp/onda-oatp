const el = id => document.getElementById(id);
const number = n => n.toLocaleString('pt-BR');
let downloadUrl;
function phases() {
  el('phase').replaceChildren(...Array.from({length:Number(el('stride').value)}, (_, i) => new Option((i + 1) + 'º', i)));
}
phases();
el('stride').addEventListener('change', phases);
el('source').onchange = () => {
  el('pick').hidden = el('source').value !== 'file';
  el('file').required = !el('pick').hidden;
};
function clearResults() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  el('save').hidden = true;
  el('save').removeAttribute('href');
  for (const id of ['sent','received','complete']) el(id).textContent = '—';
  el('ranks').replaceChildren();
  el('sequence').replaceChildren();
}
el('controls').onchange = () => {
  clearResults();
  el('state').textContent = 'Pronto para executar';
  el('state').className = '';
};
el('controls').onsubmit = async event => {
  event.preventDefault();
  clearResults();
  const fields = [...el('controls').elements];
  fields.forEach(f => f.disabled = true);
  el('state').className = '';
  el('state').textContent = 'Preparando transmissão…';
  try {
    let data, name;
    if (el('source').value === 'file') {
      const file = el('file').files[0];
      if (!file || file.size > 131072) throw Error('Escolha um arquivo de até 128 KiB.');
      data = new Uint8Array(await file.arrayBuffer());
      name = file.name;
    } else {
      data = Uint8Array.from(atob(exemploOATP), c => c.charCodeAt(0));
      name = 'exemplo-oatp.bin';
    }
    const rounds = Number(el('rounds').value);
    const result = await laboratorio.run(data, el('order').value, Number(el('stride').value),
      Number(el('phase').value), rounds, r => el('state').textContent = 'Processando rodada ' + r + ' de ' + rounds);
    const {sent,received,groups,preview,recovered} = result;
    el('state').textContent = recovered ? 'Objeto recuperado · ' + number(data.length) + ' bytes' : 'Objeto incompleto';
    el('state').className = recovered ? '' : 'wait';
    el('sent').textContent = number(sent);
    el('received').textContent = number(received);
    el('complete').textContent = groups.filter(g => g.rank === g.k).length + ' / ' + groups.length;
    groups.forEach(({k,rank}, g) => {
      const row = document.createElement('div');
      row.className = 'gen';
      row.innerHTML = '<span>G' + g + '</span><div class="track"><div class="fill" style="width:' +
        100 * rank / k + '%"></div></div><span>' + rank + ' / ' + k + '</span>';
      el('ranks').append(row);
    });
    if (!groups.length) el('ranks').textContent = 'Objeto vazio verificado pelo manifesto.';
    for (const r of new Set(preview.map(cell => cell.r))) {
      const label = document.createElement('div');
      label.className = 'hint';
      label.textContent = 'Rodada ' + (r + 1);
      const dots = document.createElement('div');
      dots.className = 'dots';
      preview.filter(cell => cell.r === r).forEach(({g,keep}) => {
        const dot = document.createElement('span');
        dot.className = 'dot' + (keep ? ' on' : '');
        dot.textContent = 'G' + g;
        dot.title = dot.ariaLabel = 'Geração ' + g + (keep ? ' recebida' : ' descartada');
        dots.append(dot);
      });
      el('sequence').append(label, dots);
    }
    if (recovered) {
      downloadUrl = URL.createObjectURL(new Blob([recovered]));
      Object.assign(el('save'), {href:downloadUrl, download:name, hidden:false});
    }
  } catch (err) {
    el('state').className = 'wait';
    el('state').textContent = 'Erro · ' + err.message;
  } finally {
    fields.forEach(f => f.disabled = false);
  }
};
el('controls').requestSubmit();
