/**
 * 三名单韦恩图（SVG）。
 * 区域计数直接标注（文字用墨色，不吃系列色）；hover/点击按指针位置判定所属区域，
 * 键盘用户可改用旁边的重合表（表格视图等价物）。
 */
import { s, showTooltip, hideTooltip } from './dom.js';

const GEOM = {
  circles: [
    { key: 'A', cx: 125, cy: 95, r: 78 },
    { key: 'B', cx: 195, cy: 95, r: 78 },
    { key: 'C', cx: 160, cy: 150, r: 78 },
  ],
  // 各区域计数标注的锚点（已验证落在对应区域内）
  labels: {
    '100': [95, 72], '010': [225, 72], '001': [160, 203],
    '110': [160, 66], '101': [116, 142], '011': [204, 142], '111': [160, 113],
  },
};

const PATTERN_TEXT = {
  111: '三份名单都出现', 110: 'A、B 出现', 101: 'A、C 出现', 100: '仅 A 出现',
  '011': 'B、C 出现', '010': '仅 B 出现', '001': '仅 C 出现',
};

/**
 * @param container 挂载点
 * @param opts { counts: {hist: n}, colors: {A,B,C}, sourceNames: {A,B,C}, selected, onSelect }
 */
export function renderVenn(container, opts) {
  const { counts, colors, sourceNames, selected, onSelect } = opts;
  const svg = s('svg', {
    viewBox: '0 0 320 240', class: 'venn', role: 'img',
    'aria-label': '三份名单重合情况韦恩图',
  });

  for (const c of GEOM.circles) {
    svg.append(s('circle', {
      cx: c.cx, cy: c.cy, r: c.r,
      fill: colors[c.key], 'fill-opacity': 0.22,
      stroke: colors[c.key], 'stroke-width': 1.5,
    }));
  }
  // 名单代号标注（墨色文字 + 色点图例在图外）
  const tagPos = { A: [78, 30], B: [242, 30], C: [160, 234] };
  for (const c of GEOM.circles) {
    const [x, y] = tagPos[c.key];
    svg.append(s('text', { x, y, class: 'venn-tag', 'text-anchor': 'middle' }, c.key));
  }

  const labelNodes = new Map();
  for (const [hist, [x, y]] of Object.entries(GEOM.labels)) {
    const t = s('text', {
      x, y, class: 'venn-count', 'text-anchor': 'middle',
      'pointer-events': 'none',
    }, String(counts[hist] ?? 0));
    labelNodes.set(hist, t);
    svg.append(t);
  }

  function histAt(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * 320;
    const py = ((evt.clientY - rect.top) / rect.height) * 240;
    let hist = '';
    for (const c of GEOM.circles) {
      const inside = (px - c.cx) ** 2 + (py - c.cy) ** 2 <= c.r ** 2;
      hist += inside ? '1' : '0';
    }
    return hist === '000' ? null : hist;
  }

  function setHover(hist) {
    for (const [hst, node] of labelNodes) {
      node.classList.toggle('is-hover', hst === hist);
    }
  }

  svg.addEventListener('pointermove', (evt) => {
    const hist = histAt(evt);
    setHover(hist);
    if (!hist) { hideTooltip(); return; }
    const names = ['A', 'B', 'C'].filter((k, i) => hist[i] === '1').map((k) => sourceNames[k]);
    showTooltip(evt.clientX, evt.clientY, [
      ['台数', `${counts[hist] ?? 0} 台`],
      ['组合', PATTERN_TEXT[hist]],
      ['来源', names.join('、')],
    ]);
  });
  svg.addEventListener('pointerleave', () => { setHover(null); hideTooltip(); });
  svg.addEventListener('click', (evt) => {
    const hist = histAt(evt);
    if (hist) onSelect(hist);
  });

  // 选中态：对应计数标注加圈
  if (selected && labelNodes.has(selected)) {
    const [x, y] = GEOM.labels[selected];
    svg.append(s('circle', {
      cx: x, cy: y - 1, r: 16, class: 'venn-selected-ring',
      fill: 'none', 'pointer-events': 'none',
    }));
  }

  container.replaceChildren(svg);
}
