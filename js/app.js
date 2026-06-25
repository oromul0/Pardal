(async function () {
  const statusEl = document.getElementById('status');
  const setStatus = (msg, persist = false) => {
    statusEl.textContent = msg;
    statusEl.classList.add('visible');
    if (!persist) setTimeout(() => statusEl.classList.remove('visible'), 2500);
  };

  const ICONS = {
    location: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.09 5.18 2 2 0 0 1 5.11 3h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 11.91a16 16 0 0 0 6 6l2.27-2.27a2 2 0 0 1 2.11-.45c.9.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    delivery: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="18.5" r="2.5"/><circle cx="7.5" cy="18.5" r="2.5"/><path d="M10 18.5h6M5 18.5H3V12l3-4h4v10.5"/><path d="M10 8h4l3 4v6.5"/><path d="M14 8V4H7"/></svg>'
  };

  // SVG do marcador de food truck no mapa
  const TRUCK_SVG = `<svg viewBox="0 0 40 30" width="34" height="26" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="5" width="23" height="14" rx="2.5" fill="#d97706"/>
    <path d="M24,11 L24,19 L36,19 L36,15 L31,11 Z" fill="#c2410c"/>
    <path d="M25.5,12 L29.5,12 L33.5,15 L25.5,15 Z" fill="#fef3c7" opacity="0.85"/>
    <rect x="3" y="7" width="5" height="4" rx="1" fill="#fef3c7" opacity="0.5"/>
    <rect x="9.5" y="7" width="5" height="4" rx="1" fill="#fef3c7" opacity="0.5"/>
    <circle cx="10" cy="21.5" r="3.2" fill="#1f2937" stroke="#fff" stroke-width="1.5"/>
    <circle cx="10" cy="21.5" r="1.2" fill="#9ca3af"/>
    <circle cx="31" cy="21.5" r="3.2" fill="#1f2937" stroke="#fff" stroke-width="1.5"/>
    <circle cx="31" cy="21.5" r="1.2" fill="#9ca3af"/>
  </svg>`;

  // --- Config ---
  let config = {};
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (r.ok) config = await r.json();
  } catch (_) {}

  // --- Praças ---
  let pracas = [];
  try {
    const r = await fetch('data/pracas.json', { cache: 'no-store' });
    pracas = await r.json();
  } catch (_) {}

  // --- Food trucks ---
  let allTrucks = [];
  try {
    const r = await fetch('data/foodtrucks.json', { cache: 'no-store' });
    allTrucks = await r.json();
  } catch (e) {
    setStatus('Erro carregando food trucks', true);
    return;
  }

  // --- CSV (com auto-refresh) ---
  const csvUrl = (config.csvUrl && config.csvUrl.trim()) ? config.csvUrl : 'data/mock.csv';
  const usingMock = csvUrl === 'data/mock.csv';
  let rows = [], headers = [], truckColumn = null, columns = [];
  let lastRefresh = null;
  let currentOpenTruck = null; // truck cujo painel está aberto (pra refresh)
  let currentView = null; // 'profile' ou 'reviews'

  // Indicador de última atualização
  const updateIndicator = document.createElement('div');
  updateIndicator.className = 'last-update';
  updateIndicator.innerHTML = '<span class="update-dot"></span><span class="update-text">Carregando...</span>';
  document.body.appendChild(updateIndicator);

  function updateTimestamp() {
    if (!lastRefresh) return;
    const ago = Math.round((Date.now() - lastRefresh) / 1000);
    const text = ago < 10 ? 'agora' : ago < 60 ? `${ago}s atrás` : `${Math.floor(ago / 60)}min atrás`;
    updateIndicator.querySelector('.update-text').textContent = 'Atualizado ' + text;
  }

  async function loadCSVData() {
    const dot = updateIndicator.querySelector('.update-dot');
    dot.classList.add('loading');
    try {
      // Cache-buster: adiciona timestamp à URL pra forçar o navegador a buscar de novo
      const bustUrl = csvUrl + (csvUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
      const csvData = await new Promise((resolve, reject) => {
        Papa.parse(bustUrl, { download: true, header: true, skipEmptyLines: true, complete: resolve, error: reject });
      });
      rows = csvData.data;
      headers = csvData.meta.fields;
      truckColumn = Inference.detectTruckColumn(headers, config.foodTruckColumn);
      columns = Inference.inferColumns(rows, headers, config);
      lastRefresh = Date.now();
      updateTimestamp();

      // Se o painel de avaliações está aberto, atualiza silenciosamente
      if (currentOpenTruck && currentView === 'reviews') {
        openReviews(currentOpenTruck);
      }
    } catch (err) {
      setStatus('Erro atualizando dados', false);
    }
    dot.classList.remove('loading');
  }

  await loadCSVData();

  // Auto-refresh: busca dados novos a cada 60 segundos
  setInterval(loadCSVData, 60 * 1000);
  // Atualiza o texto "Xmin atrás" a cada 10 segundos
  setInterval(updateTimestamp, 10 * 1000);

  // --- Mapa ---
  const defaultCenter = pracas.length ? [pracas[0].lat, pracas[0].lon] : [-20.2822, -40.2940];
  const defaultZoom = pracas.length ? (pracas[0].zoom || 19) : 19;
  const map = L.map('map', { zoomControl: true }).setView(defaultCenter, defaultZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  // --- Dropdown de praças ---
  const pracaSelect = document.getElementById('pracaSelect');
  pracaSelect.innerHTML = '';
  for (const p of pracas) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.nome + ' — ' + p.bairro;
    pracaSelect.appendChild(opt);
  }
  if (pracas.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'Nenhuma praça cadastrada';
    pracaSelect.appendChild(opt);
  }
  pracaSelect.addEventListener('change', () => {
    const p = pracas.find(x => x.id === pracaSelect.value);
    if (p) {
      map.setView([p.lat, p.lon], p.zoom || 19, { animate: true });
      renderTrucks(p.id);
    }
  });

  // --- Marcadores (ícone de caminhão) ---
  const truckIcon = L.divIcon({
    className: '',
    html: `<div class="truck-marker">${TRUCK_SVG}</div>`,
    iconSize: [34, 26],
    iconAnchor: [17, 13]
  });
  let truckMarkers = [];
  let currentTrucks = [];

  function renderTrucks(pracaId) {
    truckMarkers.forEach(m => map.removeLayer(m));
    truckMarkers = [];
    currentTrucks = pracaId
      ? allTrucks.filter(t => t.pracaId === pracaId)
      : allTrucks;

    for (const t of currentTrucks) {
      const m = L.marker([t.lat, t.lon], { icon: truckIcon, title: t.nome }).addTo(map);
      m.bindTooltip(t.nome, { direction: 'top', offset: [0, -10] });
      m.on('click', () => {
        map.setView([t.lat, t.lon], Math.max(map.getZoom(), 19), { animate: true });
        openProfile(t);
      });
      truckMarkers.push(m);
    }
  }
  renderTrucks(pracas.length ? pracas[0].id : null);

  // --- Busca ---
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) { searchResults.classList.add('hidden'); return; }

    const hits = [];
    for (const p of pracas) {
      if (p.nome.toLowerCase().includes(q) || p.bairro.toLowerCase().includes(q)) {
        hits.push({ type: 'praca', label: p.nome, data: p });
      }
    }
    for (const t of allTrucks) {
      if (t.nome.toLowerCase().includes(q)) {
        hits.push({ type: 'truck', label: t.nome, data: t });
      }
    }

    if (hits.length === 0) {
      searchResults.innerHTML = '<li style="color:var(--muted)">Nenhum resultado</li>';
    } else {
      searchResults.innerHTML = hits.slice(0, 8).map((h, i) =>
        `<li data-idx="${i}"><span class="result-type">${h.type === 'praca' ? 'Praça' : 'Food truck'}</span>${escapeHtml(h.label)}</li>`
      ).join('');
      searchResults.querySelectorAll('li[data-idx]').forEach(li => {
        li.addEventListener('click', () => {
          const h = hits[Number(li.dataset.idx)];
          if (h.type === 'praca') {
            pracaSelect.value = h.data.id;
            pracaSelect.dispatchEvent(new Event('change'));
          } else {
            map.setView([h.data.lat, h.data.lon], 20, { animate: true });
            openProfile(h.data);
          }
          searchInput.value = '';
          searchResults.classList.add('hidden');
        });
      });
    }
    searchResults.classList.remove('hidden');
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => searchResults.classList.add('hidden'), 200);
  });

  // --- Sidebar ---
  const sidebar = document.getElementById('sidebar');
  const sidebarContent = document.getElementById('sidebarContent');
  document.getElementById('closeSidebar').addEventListener('click', () => {
    sidebar.classList.add('hidden');
    currentOpenTruck = null;
    currentView = null;
  });

  // --- Perfil ---
  function openProfile(truck) {
    currentOpenTruck = truck;
    currentView = 'profile';

    const initial = truck.nome.charAt(0).toUpperCase();
    const hasCover = truck.fotoCapa && truck.fotoCapa.trim();
    const hasAvatar = truck.fotoPerfil && truck.fotoPerfil.trim();
    const hasMenu = truck.fotoCardapio && truck.fotoCardapio.trim();

    const coverStyle = hasCover
      ? `background-image:url('${truck.fotoCapa}');background-size:cover;background-position:center;`
      : '';
    const avatarContent = hasAvatar ? `<img src="${truck.fotoPerfil}" alt="${escapeHtml(truck.nome)}">` : initial;
    const avatarStyle = hasAvatar ? `background-image:url('${truck.fotoPerfil}');background-color:transparent;color:transparent;` : '';

    const endereco = truck.endereco || '';
    const telefone = truck.telefone || '';
    const descricao = truck.descricao || '';

    // Contagem de avaliações
    const truckRows = truckColumn ? rows.filter(r => String(r[truckColumn] || '').trim() === truck.nome) : [];
    const reviewCount = truckRows.length;

    let html = `
      <div class="profile-cover" style="${coverStyle}"></div>
      <div class="profile-avatar" style="${avatarStyle}">${avatarContent}</div>
      <div class="profile-body">
        <h2>${escapeHtml(truck.nome)}</h2>
        ${descricao ? `<div class="profile-desc">${escapeHtml(descricao)}</div>` : '<div class="profile-desc" style="font-style:italic">Sem descrição cadastrada</div>'}

        <div class="profile-fields">
          <div class="profile-field">
            <span class="field-icon">${ICONS.location}</span>
            ${endereco
              ? `<span class="field-text">${escapeHtml(endereco)}</span>
                 <button class="copy-btn" data-copy="${escapeHtml(endereco)}" title="Copiar endereço">${ICONS.copy}</button>`
              : '<span class="field-text field-empty">Endereço não informado</span>'}
          </div>
          <div class="profile-field">
            <span class="field-icon">${ICONS.phone}</span>
            ${telefone
              ? `<span class="field-text">${escapeHtml(telefone)}</span>`
              : '<span class="field-text field-empty">Telefone não informado</span>'}
          </div>
        </div>

        <div class="delivery-badge ${truck.delivery ? 'active' : 'inactive'}">
          ${ICONS.delivery}
          <span>${truck.delivery ? 'Faz delivery' : 'Não faz delivery'}</span>
        </div>

        <div class="menu-section">
          <h3>Cardápio</h3>
          <div class="menu-photo">
            ${hasMenu
              ? `<img src="${truck.fotoCardapio}" alt="Cardápio de ${escapeHtml(truck.nome)}">`
              : '<div class="menu-placeholder">Foto do cardápio não disponível</div>'}
          </div>
        </div>

        <button class="btn-reviews" data-truck-id="${truck.id}">Ver avaliações (${reviewCount})</button>
      </div>`;

    sidebarContent.innerHTML = html;
    sidebar.classList.remove('hidden');
    sidebar.scrollTop = 0;

    sidebarContent.querySelector('.btn-reviews').addEventListener('click', () => openReviews(truck));
    sidebarContent.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copy).then(() => setStatus('Endereço copiado!'));
      });
    });
  }

  // --- Avaliações ---
  function openReviews(truck) {
    currentOpenTruck = truck;
    currentView = 'reviews';

    const truckRows = truckColumn
      ? rows.filter(r => String(r[truckColumn] || '').trim() === truck.nome)
      : [];
    const aggregated = Inference.aggregateForTruck(columns, truckRows);

    let html = `
      <button class="btn-back" data-truck-id="${truck.id}">&larr; voltar ao perfil</button>
      <div class="reviews-panel">
        <h2>Avaliações — ${escapeHtml(truck.nome)}</h2>
        <div class="meta">${truckRows.length} avaliação(ões)</div>`;

    if (truckRows.length === 0) {
      html += '<p class="meta" style="margin-top:14px">Sem avaliações ainda.</p>';
    }

    for (const col of aggregated) {
      if (col.type === 'numeric' && col.count > 0) {
        const pct = (col.avg / col.scale) * 100;
        html += `
          <div class="metric">
            <div class="metric-label">${escapeHtml(col.label)}</div>
            <div class="metric-value">
              <span>${col.avg.toFixed(1)} / ${col.scale}</span>
              <span class="bar"><span style="width:${pct.toFixed(0)}%"></span></span>
            </div>
            <div class="stars">${renderStars(col.avg, col.scale)}</div>
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
        html += `<h3>${escapeHtml(col.label)}</h3><ul class="comments">`;
        for (const v of col.values) { html += `<li>${escapeHtml(v)}</li>`; }
        html += '</ul>';
      } else if (col.type === 'timestamp' && col.latest) {
        const d = col.latest;
        const fmt = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
        html += `<div class="meta" style="margin-top:8px">Última avaliação em ${fmt}</div>`;
      }
    }
    html += '</div>';

    sidebarContent.innerHTML = html;
    sidebar.classList.remove('hidden');
    sidebar.scrollTop = 0;

    sidebarContent.querySelector('.btn-back').addEventListener('click', () => openProfile(truck));
  }

  function renderStars(avg, scale) {
    const norm = (avg / scale) * 5;
    const full = Math.floor(norm);
    const half = (norm - full) >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  if (usingMock) {
    setStatus('Modo demonstração — dados fictícios.', true);
  }
})();
