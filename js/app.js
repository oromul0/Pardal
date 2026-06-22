// App principal — carrega config, food trucks, CSV, renderiza mapa e painel.
(async function () {
  const statusEl = document.getElementById('status');
  const setStatus = (msg, persist = false) => {
    statusEl.textContent = msg;
    statusEl.classList.add('visible');
    if (!persist) setTimeout(() => statusEl.classList.remove('visible'), 2500);
  };

  // 1. Config (opcional)
  let config = {};
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (r.ok) config = await r.json();
  } catch (_) { /* sem config */ }

  // 2. Food trucks
  let trucks = [];
  try {
    const r = await fetch('data/foodtrucks.json', { cache: 'no-store' });
    trucks = await r.json();
  } catch (e) {
    setStatus('Erro carregando food trucks', true);
    return;
  }

  // 3. CSV — usa config.csvUrl se houver, senão mock
  const csvUrl = (config.csvUrl && config.csvUrl.trim()) ? config.csvUrl : 'data/mock.csv';
  const usingMock = csvUrl === 'data/mock.csv';

  const csvData = await new Promise((resolve, reject) => {
    Papa.parse(csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: res => resolve(res),
      error: err => reject(err)
    });
  }).catch(err => {
    setStatus('Erro lendo CSV: ' + err.message, true);
    return null;
  });

  const rows = csvData ? csvData.data : [];
  const headers = csvData ? csvData.meta.fields : [];

  const truckColumn = Inference.detectTruckColumn(headers, config.foodTruckColumn);
  const columns = Inference.inferColumns(rows, headers, config);

  // Mapa
  const center = [-20.2585, -40.2360];
  const map = L.map('map', { zoomControl: true }).setView(center, 19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  // Marcador central da praça → abre lista lateral
  const plazaIcon = L.divIcon({
    className: '',
    html: '<div style="background:#2a8a5f;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid #fff;">P</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
  L.marker(center, { icon: plazaIcon, title: 'Praça Jardim Napen' })
    .addTo(map)
    .on('click', openTruckList);

  // Marcadores dos food trucks
  const truckMarkers = new Map();
  for (const t of trucks) {
    const m = L.circleMarker([t.lat, t.lon], {
      radius: 9,
      color: '#fff',
      weight: 2,
      fillColor: '#d97706',
      fillOpacity: 0.95
    }).addTo(map);
    m.bindTooltip(t.nome, { direction: 'top' });
    m.on('click', () => openTruckDetails(t));
    truckMarkers.set(t.id, m);
  }

  // Sidebar
  const sidebar = document.getElementById('sidebar');
  const sidebarContent = document.getElementById('sidebarContent');
  document.getElementById('closeSidebar').addEventListener('click', () => {
    sidebar.classList.add('hidden');
  });

  function openTruckList() {
    const counts = new Map();
    if (truckColumn) {
      for (const r of rows) {
        const k = String(r[truckColumn] || '').trim();
        if (!k) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    let html = '<h2>Food trucks da praça</h2>';
    html += `<div class="meta">${trucks.length} estabelecimentos${usingMock ? ' — exibindo dados de demonstração' : ''}</div>`;
    html += '<ul class="truck-list">';
    for (const t of trucks) {
      const n = counts.get(t.nome) || 0;
      html += `<li data-truck-id="${t.id}"><span>${escapeHtml(t.nome)}</span><span class="count">${n} aval.</span></li>`;
    }
    html += '</ul>';
    sidebarContent.innerHTML = html;
    sidebar.classList.remove('hidden');
    sidebarContent.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        const id = Number(li.dataset.truckId);
        const t = trucks.find(x => x.id === id);
        if (t) {
          map.setView([t.lat, t.lon], 20, { animate: true });
          openTruckDetails(t);
        }
      });
    });
  }

  function openTruckDetails(truck) {
    const truckRows = truckColumn
      ? rows.filter(r => String(r[truckColumn] || '').trim() === truck.nome)
      : [];

    const aggregated = Inference.aggregateForTruck(columns, truckRows);

    let html = `<h2>${escapeHtml(truck.nome)}</h2>`;
    html += `<div class="meta">${truckRows.length} avaliação(ões)</div>`;

    if (truckRows.length === 0) {
      html += '<p class="meta" style="margin-top:14px">Sem avaliações ainda para este estabelecimento.</p>';
    }

    for (const col of aggregated) {
      if (col.type === 'numeric' && col.count > 0) {
        const pct = (col.avg / col.scale) * 100;
        const stars = renderStars(col.avg, col.scale);
        html += `
          <div class="metric">
            <div class="metric-label">${escapeHtml(col.label)}</div>
            <div class="metric-value">
              <span>${col.avg.toFixed(1)} / ${col.scale}</span>
              <span class="bar"><span style="width:${pct.toFixed(0)}%"></span></span>
            </div>
            <div class="stars">${stars}</div>
            <div class="meta">${col.count} resposta(s)</div>
          </div>`;
      } else if (col.type === 'categorical' && col.total > 0) {
        html += `<h3>${escapeHtml(col.label)}</h3>`;
        const entries = [...col.counts.entries()].sort((a, b) => b[1] - a[1]);
        for (const [k, c] of entries) {
          const pct = (c / col.total) * 100;
          html += `
            <div class="dist-row">
              <span class="dist-label">${escapeHtml(k)}</span>
              <span class="dist-bar"><span style="width:${pct.toFixed(0)}%"></span></span>
              <span class="dist-pct">${pct.toFixed(0)}%</span>
            </div>`;
        }
      } else if (col.type === 'text' && col.values.length > 0) {
        html += `<h3>${escapeHtml(col.label)}</h3>`;
        html += '<ul class="comments">';
        for (const v of col.values) {
          html += `<li>${escapeHtml(v)}</li>`;
        }
        html += '</ul>';
      } else if (col.type === 'timestamp' && col.latest) {
        const d = col.latest;
        const fmt = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
        html += `<div class="meta" style="margin-top:8px">Última avaliação em ${fmt}</div>`;
      }
    }

    sidebarContent.innerHTML = '';
    const back = document.createElement('button');
    back.textContent = '← voltar à lista';
    back.style.cssText = 'background:transparent;border:0;color:#2a8a5f;cursor:pointer;font-size:13px;padding:0;margin-bottom:8px;font-weight:500;';
    back.addEventListener('click', openTruckList);
    sidebarContent.appendChild(back);
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    sidebarContent.appendChild(wrap);
    sidebar.classList.remove('hidden');
  }

  function renderStars(avg, scale) {
    const norm = (avg / scale) * 5;
    const full = Math.floor(norm);
    const half = (norm - full) >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  if (usingMock) {
    setStatus('Modo demonstração: dados fictícios. Configure config.json para usar dados reais.', true);
  }
})();
