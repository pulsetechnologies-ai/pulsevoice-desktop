// The screen-share picker's page script (local, no remote content). Draws what main.js sends; sends back one id.
(() => {
  const $ = (id) => document.getElementById(id);
  let rows = [];
  let tab = 'screen';
  let picked = null;
  let strings = {};

  function render() {
    const grid = $('grid');
    grid.textContent = '';
    const shown = rows.filter((r) => r.kind === tab);
    if (shown.length === 0) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = strings.none || '';
      grid.appendChild(p);
    }
    for (const r of shown) {
      const card = document.createElement('button');
      card.className = 'card';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(picked === r.id));
      card.setAttribute('aria-label', r.name);
      if (r.thumbnail) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.alt = '';
        img.src = r.thumbnail;
        card.appendChild(img);
      }
      const name = document.createElement('div');
      name.className = 'name';
      if (r.icon) {
        const ic = document.createElement('img');
        ic.alt = '';
        ic.src = r.icon;
        name.appendChild(ic);
      }
      const label = document.createElement('span');
      label.textContent = r.name;
      name.appendChild(label);
      card.appendChild(name);
      card.addEventListener('click', () => { picked = r.id; $('share').disabled = false; render(); });
      card.addEventListener('dblclick', () => window.pulsevoiceShare.choose(r.id, $('audio').checked));
      grid.appendChild(card);
    }
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.kind === tab));
  }

  window.pulsevoiceShare.onSources((list, s, audioOffered) => {
    rows = list;
    strings = s || {};
    document.title = strings.title || 'PulseVoice';
    $('title').textContent = strings.title || '';
    $('cancel').textContent = strings.cancel || '';
    $('share').textContent = strings.share || '';
    $('audioText').textContent = strings.audio || '';
    $('audioLabel').hidden = !audioOffered;
    const tabs = $('tabs');
    tabs.textContent = '';
    for (const [kind, text] of [['screen', strings.screens], ['window', strings.windows]]) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.dataset.kind = kind;
      b.setAttribute('role', 'tab');
      b.textContent = text || kind;
      b.addEventListener('click', () => { tab = kind; render(); });
      tabs.appendChild(b);
    }
    tab = rows.some((r) => r.kind === 'screen') ? 'screen' : 'window';
    render();
  });

  $('cancel').addEventListener('click', () => window.pulsevoiceShare.cancel());
  $('share').addEventListener('click', () => { if (picked) window.pulsevoiceShare.choose(picked, $('audio').checked); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.pulsevoiceShare.cancel(); });
})();
