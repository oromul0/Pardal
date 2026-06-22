// Motor de inferência de colunas — decide como renderizar cada coluna do CSV
// sem que o autor do Forms precise informar nada.
//
// Regras (ver README.md):
//  - numeric: ≥80% dos valores não vazios são números entre 1 e 10 (escala)
//  - categorical: ≤6 valores únicos repetidos (Sim/Não, escalas Likert curtas, etc.)
//  - timestamp: cabeçalho parece carimbo de data/hora do Forms
//  - personal: cabeçalho sugere dado pessoal (e-mail, nome, telefone) → ignora
//  - text: tudo o que sobrar → comentários

const PERSONAL_HEADER_PATTERNS = [
  /e-?mail/i, /endere[çc]o de e-?mail/i,
  /\bnome\b/i, /nome completo/i,
  /telefone/i, /celular/i, /whats/i,
  /cpf/i, /rg/i, /endere[çc]o/i
];

const TIMESTAMP_HEADER_PATTERNS = [
  /carimbo de data\/?hora/i, /timestamp/i, /data e hora/i, /^data$/i
];

const TRUCK_HEADER_HINTS = [
  /food.?truck/i, /empreendimento/i, /estabelecimento/i, /barraca/i, /comerciante/i
];

function isPersonalHeader(h) { return PERSONAL_HEADER_PATTERNS.some(re => re.test(h)); }
function isTimestampHeader(h) { return TIMESTAMP_HEADER_PATTERNS.some(re => re.test(h)); }

function detectTruckColumn(headers, configured) {
  if (configured && headers.includes(configured)) return configured;
  for (const h of headers) {
    if (TRUCK_HEADER_HINTS.some(re => re.test(h))) return h;
  }
  return null;
}

function parseNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Recebe todas as linhas (objetos) + lista de headers + config opcional.
// Devolve metadados por coluna: { name, label, type, ...stats }
function inferColumns(rows, headers, config = {}) {
  const labels = config.columnLabels || {};
  const hidden = new Set(config.hiddenColumns || []);
  const result = [];

  for (const h of headers) {
    if (hidden.has(h)) continue;
    if (isPersonalHeader(h)) continue;

    const label = labels[h] || h;
    const values = rows.map(r => r[h]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');

    if (isTimestampHeader(h)) {
      result.push({ name: h, label, type: 'timestamp', values });
      continue;
    }

    if (values.length === 0) {
      // coluna vazia — ignora
      continue;
    }

    const nums = values.map(parseNumber).filter(n => n !== null);
    const numericRatio = nums.length / values.length;
    const inRange = nums.filter(n => n >= 1 && n <= 10);
    const inRangeRatio = inRange.length / Math.max(nums.length, 1);

    if (numericRatio >= 0.8 && inRangeRatio >= 0.8 && nums.length > 0) {
      const max = Math.max(...nums);
      const scale = max <= 5 ? 5 : 10;
      result.push({ name: h, label, type: 'numeric', scale, values: nums });
      continue;
    }

    const unique = new Map();
    for (const v of values) {
      const s = String(v).trim();
      unique.set(s, (unique.get(s) || 0) + 1);
    }

    // Se há poucos valores distintos E pelo menos um se repete (não é texto livre)
    const hasRepeats = [...unique.values()].some(c => c > 1);
    if (unique.size > 0 && unique.size <= 6 && hasRepeats) {
      result.push({ name: h, label, type: 'categorical', counts: unique, total: values.length });
      continue;
    }

    // Texto livre
    result.push({ name: h, label, type: 'text', values });
  }

  // Ordem customizada
  if (Array.isArray(config.columnOrder) && config.columnOrder.length > 0) {
    const order = config.columnOrder;
    result.sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  return result;
}

// Agrega um conjunto de linhas (já filtradas para um food truck) por coluna
function aggregateForTruck(columns, truckRows) {
  return columns.map(col => {
    const vals = truckRows.map(r => r[col.name]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
    if (col.type === 'numeric') {
      const nums = vals.map(parseNumber).filter(n => n !== null);
      if (nums.length === 0) return { ...col, count: 0 };
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return { ...col, avg, count: nums.length };
    }
    if (col.type === 'categorical') {
      const counts = new Map();
      for (const v of vals) {
        const s = String(v).trim();
        counts.set(s, (counts.get(s) || 0) + 1);
      }
      return { ...col, counts, total: vals.length };
    }
    if (col.type === 'text') {
      return { ...col, values: vals.slice(-5).reverse() };
    }
    if (col.type === 'timestamp') {
      const parsed = vals.map(v => new Date(v)).filter(d => !isNaN(d.getTime()));
      const latest = parsed.length ? parsed.reduce((a, b) => a > b ? a : b) : null;
      return { ...col, latest };
    }
    return col;
  });
}

window.Inference = { inferColumns, aggregateForTruck, detectTruckColumn };
