// App principal — carrega config, food trucks, CSV, renderiza mapa.
// Marcadores arrastáveis: você pode reposicionar cada food truck direto no mapa
// e clicar em "Exportar posições" para baixar um foodtrucks.json atualizado.
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
  const center = [-20.2822, -40.2940]; // Praça Regina Frigeri Furno, Jardim da Penha, Vitória-ES
  const map = L.map('map', { zoomControl: true }).setView(center, 19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  // Marcadores arrastáveis dos food trucks
  // Usamos L.marker (com ícone customizado) em vez de circleMarker porque
  // só L.marker tem suporte nativo a draggable.
  const truckMarkers = new Map();
  const truckIcon = L.divIcon({
    className: '',
    html: '<div class="truck-pin" title="Arraste para reposicionar"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  for (const t of trucks) {
    const m = L.marker([t.lat, t.lon], {
      icon: truckIcon,
      draggable: true,
      title: t.nome
    }).addTo(map);
    m.bindTooltip(t.nome, { direction: 'top', offset: [0, -8] });
    m.on('click', () => openTruckDetails(t));
    m.on('dragend', () => {
      const ll = m.getLatLng();
      t.lat = Number(ll.lat.toFixed(6));
      t.lon = Number(ll.lng.toFixed(6));
      setStatus(`${t.nome} reposicionado — lembre de exportar.`);
    });
    truckMarkers.set(t.id, m);
  }

  // Botão "Exportar posições" — gera um arquivo JSON para download
  const ExportControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control export-control');
      div.innerHTML = '<button id="exportBtn" title="Baixar foodtrucks.json com as posições atuais">Exportar posições</button>';
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  map.addControl(new ExportControl());
  document.getElementById('exportBtn').addEventListener('click', () => {
    const json = JSON.stringify(trucks, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'foodtrucks.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus('foodtrucks.json baixado. Substitua o arquivo em data/ e faça commit.', true);
  });

  // Sidebar — só abre quando se clica em um food truck
  const sidebar = document.getElementById('sidebar');
  const sidebarContent = document.getElementById('sidebarContent');
  document.getElementById('closeSidebar').addEventListener('click', () => {
    sidebar.classList.add('hidden');
  });

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

    sidebarContent.innerHTML = html;
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
