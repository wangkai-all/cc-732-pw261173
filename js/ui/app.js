/**
 * 设备底册完整度分析 —— 主应用。
 * 名单整理 → 身份决议 → 重合表 → 总体估计 → 待定别名影响，全部在前端实际运行。
 * 虚构数据，不连接任何真实资产系统。
 */
import { main as dsMain, contractor as dsContractor } from '../data/index.js';
import { curateSource, resolveIdentities, normalizeId } from '../core/identity.js';
import { buildOverlap, CELL_ORDER } from '../core/overlap.js';
import { estimateAll, modelResult } from '../core/estimate.js';
import { MODELS } from '../core/loglinear.js';
import { h, fmtInt, fmt1, fmt2 } from './dom.js';
import { renderVenn } from './venn.js';
import { renderModelBars, renderSegmented } from './charts.js';

const DATASETS = { main: dsMain, contractor: dsContractor };
const SOURCE_COLORS = { A: '#2a78d6', B: '#eb6834', C: '#1baf7a' };

const state = {
  datasetId: 'main',
  decisions: {},          // pendingId → 'merge' | 'separate'（缺省 = 未决，按分开处理）
  currentModel: 'indep',
  selectedCell: null,
  expandedSources: new Set(),
  revealTruth: false,
};

/* ---------------- 管线：名单整理 → 身份决议 → 重合表 → 总体估计 ---------------- */
function pipeline(dataset, decisions) {
  const curated = dataset.sources.map(curateSource);
  const resolution = resolveIdentities(curated, dataset.confirmedAliases, dataset.pendingAliases, decisions);
  const sourceIds = dataset.sources.map((s) => s.id);
  const overlap = buildOverlap(resolution.devices, sourceIds);
  const estimation = estimateAll(overlap.counts7);
  const byNorm = new Map();
  for (const src of curated) {
    for (const rec of src.records) {
      if (!byNorm.has(rec.normId)) byNorm.set(rec.normId, []);
      byNorm.get(rec.normId).push(rec);
    }
  }
  return { curated, resolution, overlap, estimation, byNorm };
}

const currentModelMeta = () => MODELS.find((m) => m.id === state.currentModel);

/* ---------------- 通用小部件 ---------------- */
const sourceDot = (sid) => h('span', { class: 'source-dot', style: `background:${SOURCE_COLORS[sid]}` });

const statusChip = (status) => {
  if (status === 'ok') return h('span', { class: 'chip chip-good' }, '✓ 可估');
  if (status === 'unidentifiable') return h('span', { class: 'chip chip-muted' }, '⊘ 不可辨识');
  return h('span', { class: 'chip chip-serious' }, '✕ 不可估');
};

function patternChips(hist, sourceIds) {
  return h('span', { class: 'pattern' }, sourceIds.map((sid, i) =>
    h('span', { class: `pattern-chip${hist[i] === '1' ? ' on' : ''}` },
      sourceDot(sid), `${sid} ${hist[i] === '1' ? '✓' : '—'}`)));
}

/* ---------------- 数据集切换 ---------------- */
function renderDatasetTabs() {
  const tabs = Object.values(DATASETS).map((ds) => h('button', {
    class: `tab${ds.id === state.datasetId ? ' is-active' : ''}`,
    role: 'tab',
    'aria-selected': ds.id === state.datasetId ? 'true' : 'false',
    onclick: () => {
      state.datasetId = ds.id;
      state.decisions = {};
      state.selectedCell = null;
      state.revealTruth = false;
      renderAll();
    },
  }, ds.name));
  document.querySelector('#dataset-tabs').replaceChildren(...tabs);
  const ds = DATASETS[state.datasetId];
  document.querySelector('#dataset-desc').textContent = ds.description;
}

/* ---------------- 1. 名单整理 ---------------- */
function renderCuration(ds, p) {
  const cards = ds.sources.map((src, i) => {
    const cur = p.curated[i];
    const expanded = state.expandedSources.has(src.id);
    const issueList = cur.issues.length
      ? h('ul', { class: 'issue-list' }, cur.issues.map((iss) => h('li', {},
          h('span', { class: iss.type === 'dropped' ? 'chip chip-serious' : 'chip chip-warning' },
            iss.type === 'dropped' ? '✕ 剔除' : '⚠ 去重'),
          iss.summary)))
      : h('p', { class: 'muted' }, '未发现需要整理的问题。');

    let table = null;
    if (expanded) {
      const rows = cur.records.map((r) => h('tr', {},
        h('td', {}, r.rawId),
        h('td', { class: 'mono' }, r.normId),
        h('td', {}, r.name),
        h('td', {}, r.location),
        h('td', {}, r.model),
        h('td', { class: 'num' }, r.date),
        h('td', {}, r.inspector),
      ));
      table = h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, '原始编号'), h('th', {}, '规范化编号'), h('th', {}, '名称'),
          h('th', {}, '位置'), h('th', {}, '型号'), h('th', {}, '日期'), h('th', {}, '巡检人'))),
        h('tbody', {}, rows)));
    }

    return h('article', { class: 'card source-card' },
      h('header', { class: 'source-head' },
        sourceDot(src.id),
        h('h3', {}, `名单 ${src.id} · ${src.name}`),
        h('span', { class: 'muted' }, `原始 ${cur.rawCount} 条 → 有效 ${cur.records.length} 条`)),
      issueList,
      h('button', {
        class: 'link-btn',
        'aria-expanded': expanded ? 'true' : 'false',
        onclick: () => {
          if (state.expandedSources.has(src.id)) state.expandedSources.delete(src.id);
          else state.expandedSources.add(src.id);
          renderAll();
        },
      }, expanded ? '收起记录' : `查看全部 ${cur.records.length} 条记录`),
      table);
  });
  document.querySelector('#sec-curation .section-body').replaceChildren(...cards);
}

/* ---------------- 2. 身份决议 ---------------- */
function sideEvidence(ds, p, rawId) {
  const norm = normalizeId(rawId);
  const recs = p.byNorm.get(norm) ?? [];
  const srcs = [...new Set(recs.map((r) => r.sourceId))];
  const first = recs[0] ?? {};
  return { norm, recs, srcs, name: first.name ?? '—', location: first.location ?? '—', model: first.model ?? '—' };
}

function renderIdentity(ds, p) {
  const undecided = ds.pendingAliases.filter((pa) => !state.decisions[pa.id]);
  const allDecided = ds.pendingAliases.length > 0 && undecided.length === 0;

  const summary = h('p', { class: 'section-note' },
    `当前决议下共 ${fmtInt(p.resolution.devices.size)} 台设备；`,
    `已确认别名 ${p.resolution.appliedConfirmed.length} 条已自动应用；`,
    ds.pendingAliases.length
      ? `待定别名 ${ds.pendingAliases.length} 条（${undecided.length} 条未决，未决按不合并处理）。`
      : '本数据集没有待定别名。');

  // 已确认别名表
  const confirmedTable = p.resolution.appliedConfirmed.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '名单中的写法'), h('th', {}, ''), h('th', {}, '规范编号'), h('th', {}, '确认依据'))),
        h('tbody', {}, p.resolution.appliedConfirmed.map((al) => h('tr', {},
          h('td', { class: 'mono' }, al.from),
          h('td', { class: 'muted' }, '→'),
          h('td', { class: 'mono' }, al.to),
          h('td', {}, al.basis))))))
    : h('p', { class: 'muted' }, '无已确认别名。');

  // 待定别名卡片
  const pendingCards = ds.pendingAliases.map((pa) => {
    const decision = state.decisions[pa.id] ?? null;
    const sides = pa.pair.map((raw) => sideEvidence(ds, p, raw));
    const evidenceRows = sides.map((ev) => h('div', { class: 'evidence-side' },
      h('div', { class: 'mono evidence-id' }, ev.norm),
      h('dl', {},
        h('dt', {}, '出现于'), h('dd', {}, ev.srcs.length ? ev.srcs.join('、') : '—'),
        h('dt', {}, '名称'), h('dd', {}, ev.name),
        h('dt', {}, '位置'), h('dd', {}, ev.location),
        h('dt', {}, '型号'), h('dd', {}, ev.model))));

    let truthLine = null;
    if (state.revealTruth && ds.truth) {
      const same = pa.truthSame;
      const correct = (decision === 'merge') === same;
      truthLine = h('p', { class: `truth-reveal ${correct ? 'is-correct' : 'is-wrong'}` },
        correct ? '✓ ' : '✗ ',
        `虚构真值：两者${same ? '是同一台设备' : '是不同设备'}。你的判断：${decision === 'merge' ? '合并' : '分开'}。`);
    }

    return h('article', { class: `card pending-card${decision ? '' : ' is-undecided'}` },
      h('header', { class: 'pending-head' },
        h('strong', {}, `${pa.pair[0]} ⇄ ${pa.pair[1]}`),
        decision
          ? h('span', { class: `chip ${decision === 'merge' ? 'chip-good' : 'chip-muted'}` },
              decision === 'merge' ? '✓ 已合并' : '已分开')
          : h('span', { class: 'chip chip-warning' }, '⚠ 未决')),
      h('p', { class: 'muted' }, pa.note),
      h('div', { class: 'evidence-grid' }, evidenceRows),
      h('div', { class: 'btn-row' },
        h('button', {
          class: `btn${decision === 'merge' ? ' is-active' : ''}`,
          'aria-pressed': decision === 'merge' ? 'true' : 'false',
          onclick: () => { state.decisions[pa.id] = 'merge'; renderAll(); },
        }, '合并为同一台'),
        h('button', {
          class: `btn${decision === 'separate' ? ' is-active' : ''}`,
          'aria-pressed': decision === 'separate' ? 'true' : 'false',
          onclick: () => { state.decisions[pa.id] = 'separate'; renderAll(); },
        }, '保持分开'),
        decision ? h('button', {
          class: 'link-btn',
          onclick: () => { delete state.decisions[pa.id]; renderAll(); },
        }, '重置为未决') : null),
      truthLine);
  });

  const revealBtn = allDecided && ds.truth && !state.revealTruth
    ? h('button', { class: 'btn', onclick: () => { state.revealTruth = true; renderAll(); } },
        '全部已决定 —— 对照虚构真值')
    : null;

  const notes = p.resolution.notes.length
    ? h('ul', { class: 'issue-list' }, p.resolution.notes.map((n) => h('li', {},
        h('span', { class: 'chip chip-warning' }, '⚠ 归并'), n)))
    : null;

  document.querySelector('#sec-identity .section-body').replaceChildren(
    summary,
    h('h3', { class: 'subhead' }, '已确认别名（自动应用）'),
    confirmedTable,
    ds.pendingAliases.length ? h('h3', { class: 'subhead' }, '待定别名（疑似同名不能自动合并，请逐项判断）') : null,
    ...pendingCards,
    revealBtn,
    notes,
  );
}

/* ---------------- 3. 重合表 ---------------- */
function renderOverlap(ds, p) {
  const counts = {};
  for (const hist of CELL_ORDER) counts[hist] = p.overlap.cells.get(hist).count;
  const sourceNames = Object.fromEntries(ds.sources.map((s) => [s.id, s.name]));

  renderVenn(document.querySelector('#venn-container'), {
    counts,
    colors: SOURCE_COLORS,
    sourceNames,
    selected: state.selectedCell,
    onSelect: (hist) => { state.selectedCell = hist; renderAll(); },
  });

  // 图例（色点 + 名称，文字用墨色）
  document.querySelector('#venn-legend').replaceChildren(...ds.sources.map((src) =>
    h('span', { class: 'legend-item' }, sourceDot(src.id), `名单 ${src.id} · ${src.name}`)));

  // 重合格表（韦恩图的表格视图等价物）
  const sourceIds = ds.sources.map((s) => s.id);
  const rows = [...CELL_ORDER, '000'].map((hist) => {
    const isUnobserved = hist === '000';
    const count = isUnobserved ? null : p.overlap.cells.get(hist).count;
    const selected = state.selectedCell === hist;
    return h('tr', {
      class: `${selected ? 'is-selected' : ''}${isUnobserved ? ' is-unobserved' : ''}`,
    },
      h('td', {}, patternChips(hist, sourceIds)),
      h('td', { class: 'num' }, isUnobserved ? '—' : fmtInt(count)),
      h('td', {}, h('button', {
        class: 'link-btn',
        onclick: () => { state.selectedCell = hist; renderAll(); },
      }, isUnobserved ? '说明' : '查看设备')));
  });
  document.querySelector('#overlap-table tbody').replaceChildren(...rows);

  renderDevicePanel(ds, p);
}

function renderDevicePanel(ds, p) {
  const panel = document.querySelector('#device-panel');
  const hist = state.selectedCell;
  if (!hist) {
    panel.replaceChildren(h('p', { class: 'muted' }, '点击上方重合格或韦恩图区域，查看该组合的具体设备及来源记录。'));
    return;
  }
  if (hist === '000') {
    panel.replaceChildren(
      h('h3', {}, '三份名单都未出现的设备'),
      h('p', {}, '这一格不可观测：没有任何一份名单记录这些设备，因此无法列出具体设备。'
        + '它的数量只能通过对数线性模型外推估计（见「总体估计」），且该估计依赖模型假设，不能从数据中直接验证。'));
    return;
  }
  const cell = p.overlap.cells.get(hist);
  const cards = cell.devices.map((id) => {
    const dev = p.resolution.devices.get(id);
    const aliasLine = dev.members.length > 1
      ? h('p', { class: 'muted' }, `别名：${dev.members.join('、')}`)
      : null;
    const recRows = dev.records
      .slice()
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
      .map((r) => h('tr', {},
        h('td', {}, sourceDot(r.sourceId), ` ${r.sourceId}`),
        h('td', { class: 'mono' }, r.rawId),
        h('td', { class: 'num' }, r.date),
        h('td', {}, r.inspector),
        h('td', {}, r.location)));
    return h('article', { class: 'card device-card' },
      h('header', {}, h('strong', {}, dev.id), h('span', { class: 'muted' }, ` ${dev.records[0]?.name ?? ''}`)),
      aliasLine,
      h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '来源'), h('th', {}, '原始编号'), h('th', {}, '日期'), h('th', {}, '巡检人'), h('th', {}, '位置'))),
        h('tbody', {}, recRows)));
  });
  panel.replaceChildren(
    h('h3', {}, `组合 ${hist}：${cell.count} 台设备`),
    ...cards);
}

/* ---------------- 4. 总体估计 ---------------- */
function renderEstimation(ds, p) {
  const est = p.estimation;
  const cur = modelResult(est, state.currentModel);
  const modelName = currentModelMeta().name;

  // 警告
  const warnBox = document.querySelector('#est-warnings');
  warnBox.replaceChildren(...est.warnings.map((w) =>
    h('p', { class: 'warning-line' }, h('span', { class: 'chip chip-warning' }, '⚠ 警告'), w)));

  // 反例说明（数据集备注）
  document.querySelector('#dataset-notes').replaceChildren(...(ds.notes ?? []).map((n) =>
    h('p', { class: 'note-line' }, h('span', { class: 'chip chip-muted' }, 'i 反例'), n)));

  // 三个数字并列：已确认并集（实际看见）与漏登估计（依赖假设）分开
  const missedTile = cur.status === 'ok'
    ? h('div', { class: 'tile tile-estimate' },
        h('span', { class: 'tile-label' }, '漏登估计'),
        h('span', { class: 'tile-value' }, `≈${fmt1(cur.n000)}`),
        h('span', { class: 'tile-note' }, `⚠ 依赖假设的估计 · 模型：${modelName}`))
    : h('div', { class: 'tile tile-estimate' },
        h('span', { class: 'tile-label' }, '漏登估计'),
        h('span', { class: 'tile-value tile-na' }, '不可估'),
        h('span', { class: 'tile-note' }, `⚠ ${cur.reason ?? ''}`));
  const totalTile = cur.status === 'ok'
    ? h('div', { class: 'tile' },
        h('span', { class: 'tile-label' }, '估计总数'),
        h('span', { class: 'tile-value' }, `≈${fmt1(cur.total)}`),
        h('span', { class: 'tile-note' }, '已确认并集 + 漏登估计'))
    : h('div', { class: 'tile' },
        h('span', { class: 'tile-label' }, '估计总数'),
        h('span', { class: 'tile-value tile-na' }, '—'),
        h('span', { class: 'tile-note' }, '漏登不可估，总数不可得'));

  document.querySelector('#est-tiles').replaceChildren(
    h('div', { class: 'tile tile-observed' },
      h('span', { class: 'tile-label' }, '已确认并集'),
      h('span', { class: 'tile-value' }, fmtInt(est.observedUnion)),
      h('span', { class: 'tile-note' }, '实际看见的设备数（三份名单的并集）')),
    missedTile,
    totalTile,
  );

  if (ds.truth) {
    document.querySelector('#truth-note').replaceChildren(
      h('span', { class: 'chip chip-muted' }, 'i 虚构真值'),
      `本虚构数据集的真实总数为 ${ds.truth.totalDevices} 台、真实漏登 ${ds.truth.missedByAll} 台。`,
      ds.truth.note);
  } else {
    document.querySelector('#truth-note').replaceChildren();
  }

  // 总数构成分段条
  renderSegmented(document.querySelector('#seg-container'), {
    observed: est.observedUnion,
    missed: cur.status === 'ok' ? cur.n000 : null,
    modelName,
  });

  // 模型表
  const rows = est.results.map((r) => {
    const isCurrent = r.model.id === state.currentModel;
    const clickable = r.status === 'ok';
    const pick = clickable ? () => { state.currentModel = r.model.id; renderAll(); } : null;
    return h('tr', {
      class: `${isCurrent ? 'is-current' : ''}${clickable ? ' is-clickable' : ' is-disabled'}`,
      onclick: pick,
      tabindex: clickable ? '0' : null,
      role: clickable ? 'button' : null,
      'aria-pressed': clickable ? (isCurrent ? 'true' : 'false') : null,
      onkeydown: clickable ? (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); pick(); }
      } : null,
    },
      h('td', {}, h('strong', {}, r.model.name), h('br'), h('span', { class: 'mono muted' }, r.model.formula)),
      h('td', { class: 'muted' }, r.model.assumption),
      h('td', { class: 'num' }, r.status === 'ok' ? r.p : r.model.terms.length),
      h('td', { class: 'num' }, r.status === 'ok' ? r.df : '—'),
      h('td', { class: 'num' }, r.status === 'ok' ? fmt2(r.deviance) : '—'),
      h('td', { class: 'num' }, r.status === 'ok' ? `≈${fmt1(r.n000)}` : '—'),
      h('td', { class: 'num' }, r.status === 'ok' ? `≈${fmt1(r.total)}` : '—'),
      h('td', {}, statusChip(r.status),
        r.status !== 'ok' ? h('div', { class: 'muted reason' }, r.reason) : null,
        r.saturated ? h('div', { class: 'muted reason' }, '饱和模型：对观测格无拟合优度可检验') : null));
  });
  document.querySelector('#model-table tbody').replaceChildren(...rows);

  // 模型对比条形图
  renderModelBars(document.querySelector('#model-bars'), {
    results: est.results,
    truthMissed: ds.truth ? ds.truth.missedByAll : null,
    currentModel: state.currentModel,
    onPick: (id) => { state.currentModel = id; renderAll(); },
  });
}

/* ---------------- 5. 待定别名影响与前后对照 ---------------- */
function estimateWith(ds, decisions) {
  const p = pipeline(ds, decisions);
  return { p, r: modelResult(p.estimation, state.currentModel) };
}

const fmtEst = (r) => (r.status === 'ok' ? `≈${fmt1(r.n000)}` : '不可估');

function renderImpact(ds) {
  const container = document.querySelector('#sec-impact .section-body');
  const pendings = ds.pendingAliases;
  if (!pendings.length) {
    container.replaceChildren(h('p', { class: 'muted' }, '本数据集没有待定别名，无需影响分析。'));
    return;
  }
  const modelName = currentModelMeta().name;

  // 逐个待定映射的影响（其余维持当前决定，当前模型）
  const perRows = pendings.map((pa) => {
    const merge = estimateWith(ds, { ...state.decisions, [pa.id]: 'merge' });
    const separate = estimateWith(ds, { ...state.decisions, [pa.id]: 'separate' });
    const delta = merge.r.status === 'ok' && separate.r.status === 'ok'
      ? fmt1(merge.r.n000 - separate.r.n000) : '—';
    return h('tr', {},
      h('td', { class: 'mono' }, `${pa.pair[0]} ⇄ ${pa.pair[1]}`),
      h('td', { class: 'num' }, fmtEst(merge.r)),
      h('td', { class: 'num' }, fmtEst(separate.r)),
      h('td', { class: 'num' }, delta));
  });

  // 全部未决组合的影响范围
  const ids = pendings.map((pa) => pa.id);
  let min = Infinity; let max = -Infinity; let inestimableCombos = 0;
  const totalCombos = 2 ** ids.length;
  for (let mask = 0; mask < totalCombos; mask++) {
    const decisions = {};
    ids.forEach((id, i) => { decisions[id] = (mask >> i) & 1 ? 'merge' : 'separate'; });
    const { r } = estimateWith(ds, decisions);
    if (r.status === 'ok') {
      min = Math.min(min, r.n000);
      max = Math.max(max, r.n000);
    } else inestimableCombos += 1;
  }
  const rangeText = min === Infinity
    ? '全部组合下当前模型均不可估'
    : `漏登估计 ∈ [≈${fmt1(min)}, ≈${fmt1(max)}]（当前模型：${modelName}，共 ${totalCombos} 种组合`
      + (inestimableCombos ? `，其中 ${inestimableCombos} 种不可估` : '') + '）';

  // 前后对照：全部未决（按分开） vs 当前决议，同一模型
  const before = estimateWith(ds, {});
  const after = estimateWith(ds, state.decisions);
  const cmpRows = [];
  const cellLabel = (hist) => `格 ${hist}`;
  for (let i = 0; i < CELL_ORDER.length; i++) {
    const hist = CELL_ORDER[i];
    const b = before.p.overlap.counts7[i];
    const a = after.p.overlap.counts7[i];
    cmpRows.push(h('tr', {},
      h('td', {}, cellLabel(hist)),
      h('td', { class: 'num' }, fmtInt(b)),
      h('td', { class: 'num' }, fmtInt(a)),
      h('td', { class: 'num' }, a - b === 0 ? '0' : (a - b > 0 ? `+${a - b}` : `${a - b}`))));
  }
  const cmpExtra = [
    ['已确认并集', before.p.overlap.observedUnion, after.p.overlap.observedUnion, fmtInt],
    ['漏登估计（同一模型）', before.r.status === 'ok' ? before.r.n000 : null, after.r.status === 'ok' ? after.r.n000 : null, (v) => `≈${fmt1(v)}`],
    ['估计总数（同一模型）', before.r.status === 'ok' ? before.r.total : null, after.r.status === 'ok' ? after.r.total : null, (v) => `≈${fmt1(v)}`],
  ];
  for (const [label, b, a, fmt] of cmpExtra) {
    const delta = b !== null && a !== null ? a - b : null;
    cmpRows.push(h('tr', { class: 'cmp-extra' },
      h('td', {}, label),
      h('td', { class: 'num' }, b === null ? '不可估' : fmt(b)),
      h('td', { class: 'num' }, a === null ? '不可估' : fmt(a)),
      h('td', { class: 'num' }, delta === null ? '—' : (Math.abs(delta) < 1e-9 ? '0' : `${delta > 0 ? '+' : ''}${fmt1(delta)}`))));
  }

  container.replaceChildren(
    h('h3', { class: 'subhead' }, `逐个待定映射的影响（当前模型：${modelName}）`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '待定对'), h('th', {}, '合并时漏登估计'), h('th', {}, '分开时漏登估计'), h('th', {}, '差值'))),
      h('tbody', {}, perRows))),
    h('p', { class: 'section-note' }, `全部未决组合的影响范围：${rangeText}。`),
    h('h3', { class: 'subhead' }, `别名判断前后对照（同一模型：${modelName}）`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '项目'), h('th', {}, '全部未决（按分开）'), h('th', {}, '当前决议'), h('th', {}, '差值'))),
      h('tbody', {}, cmpRows))),
  );
}

/* ---------------- 总渲染 ---------------- */
function renderAll() {
  const ds = DATASETS[state.datasetId];
  const p = pipeline(ds, state.decisions);
  renderDatasetTabs();
  renderCuration(ds, p);
  renderIdentity(ds, p);
  renderOverlap(ds, p);
  renderEstimation(ds, p);
  renderImpact(ds);
}

renderAll();
