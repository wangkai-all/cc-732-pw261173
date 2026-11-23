/**
 * 图表：模型漏登估计对比（横向条形）与总数构成（高分段条）。
 * 单一系列 → 固定 slot 1 蓝；真值参考线为墨色细线；表格视图由模型表承担。
 */
import { s, h, showTooltip, hideTooltip, fmt1, fmtInt } from './dom.js';

const BAR_X = 150;      // 条形起点
const BAR_MAX_W = 420;  // 条形最大宽度
const ROW_H = 30;
const BAR_H = 18;       // ≤24px

/** 数据端 4px 圆角、基线端方角的横条路径。 */
function endRoundedBar(x, y, w, hgt, r = 4) {
  const rr = Math.min(r, w / 2, hgt / 2);
  return `M ${x} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} `
    + `V ${y + hgt - rr} Q ${x + w} ${y + hgt} ${x + w - rr} ${y + hgt} H ${x} Z`;
}

/** 简洁刻度：1/2/5 × 10^k，≤6 个刻度。 */
function niceTicks(maxV) {
  if (maxV <= 0) return [0];
  const raw = maxV / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
  const ticks = [];
  for (let v = 0; v <= maxV + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/**
 * 各模型漏登估计对比。
 * @param container
 * @param opts { results, truthMissed, currentModel, onPick }
 */
export function renderModelBars(container, opts) {
  const { results, truthMissed, currentModel, onPick } = opts;
  const okRows = results.filter((r) => r.status === 'ok');
  const badRows = results.filter((r) => r.status !== 'ok');
  const maxV = Math.max(1, ...okRows.map((r) => r.n000), truthMissed ?? 0);
  const scale = (v) => (v / maxV) * BAR_MAX_W;
  const rows = [...okRows, ...badRows];
  const H = rows.length * ROW_H + 30;

  const svg = s('svg', { viewBox: `0 0 680 ${H}`, class: 'model-bars', role: 'img', 'aria-label': '各模型漏登估计对比' });

  // 网格线与刻度（墨色、细线、压低）
  const ticks = niceTicks(maxV);
  for (const t of ticks) {
    const x = BAR_X + scale(t);
    svg.append(s('line', { x1: x, y1: 0, x2: x, y2: H - 24, class: 'gridline' }));
    svg.append(s('text', { x, y: H - 8, class: 'tick-label', 'text-anchor': 'middle' }, fmtInt(t)));
  }
  // 基线
  svg.append(s('line', { x1: BAR_X, y1: 0, x2: BAR_X, y2: H - 24, class: 'baseline' }));

  // 虚构真值参考线
  if (truthMissed !== null && truthMissed !== undefined) {
    const x = BAR_X + scale(truthMissed);
    svg.append(s('line', { x1: x, y1: 0, x2: x, y2: H - 24, class: 'truth-line' }));
    svg.append(s('text', {
      x: Math.min(x + 4, 680 - 120), y: 10, class: 'truth-label',
    }, `虚构真值 ${fmtInt(truthMissed)}`));
  }

  rows.forEach((r, i) => {
    const y = i * ROW_H;
    const isCurrent = r.model.id === currentModel;
    svg.append(s('text', {
      x: BAR_X - 10, y: y + ROW_H / 2 + 4, class: `bar-name${isCurrent ? ' is-current' : ''}`,
      'text-anchor': 'end',
    }, r.model.name));

    if (r.status === 'ok') {
      const w = Math.max(2, scale(r.n000));
      svg.append(s('path', { d: endRoundedBar(BAR_X, y + (ROW_H - BAR_H) / 2, w, BAR_H), class: 'bar-fill' }));
      svg.append(s('text', {
        x: BAR_X + w + 6, y: y + ROW_H / 2 + 4, class: 'bar-value',
      }, `≈${fmt1(r.n000)}`));
      // 命中区域（整行高，≥24px）
      const hit = s('rect', {
        x: 0, y, width: 680, height: ROW_H, fill: 'transparent', tabindex: 0,
        role: 'button', 'aria-label': `${r.model.name}，漏登估计约 ${fmt1(r.n000)}`,
      });
      hit.addEventListener('pointermove', (evt) => showTooltip(evt.clientX, evt.clientY, [
        ['漏登估计', `≈${fmt1(r.n000)} 台`],
        ['模型', `${r.model.name}（${r.model.formula}）`],
        ['G² / 自由度', `${fmt1(r.deviance)} / ${r.df}`],
      ]));
      hit.addEventListener('pointerleave', hideTooltip);
      hit.addEventListener('click', () => onPick(r.model.id));
      hit.addEventListener('keydown', (evt) => { if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); onPick(r.model.id); } });
      svg.append(hit);
    } else {
      const label = r.status === 'unidentifiable' ? '不可辨识' : '不可估';
      const short = r.status === 'unidentifiable' ? '参数多于观测格' : '参数无有限解';
      svg.append(s('text', { x: BAR_X + 4, y: y + ROW_H / 2 + 4, class: 'bar-na' }, `${label}（${short}）`));
      const hit = s('rect', { x: 0, y, width: 680, height: ROW_H, fill: 'transparent' });
      hit.addEventListener('pointermove', (evt) => showTooltip(evt.clientX, evt.clientY, [
        ['状态', label], ['原因', r.reason ?? ''],
      ]));
      hit.addEventListener('pointerleave', hideTooltip);
      svg.append(hit);
    }
  });

  container.replaceChildren(svg);
}

/**
 * 总数构成高分段条：已确认并集（实际看见）+ 漏登估计（依赖假设）。
 * @param container
 * @param opts { observed, missed (null=不可估), modelName }
 */
export function renderSegmented(container, opts) {
  const { observed, missed, modelName } = opts;
  const W = 680;
  const total = missed === null ? observed : observed + missed;
  const wObs = (observed / total) * (W - 2);
  const wMiss = missed === null ? 0 : (missed / total) * (W - 2);

  const svg = s('svg', { viewBox: `0 0 ${W} 44`, class: 'seg-bar', role: 'img', 'aria-label': '估计总数构成' });
  svg.append(s('rect', { x: 0, y: 4, width: wObs, height: 28, rx: 4, class: 'seg-observed' }));
  if (wObs > 120) {
    svg.append(s('text', { x: 10, y: 23, class: 'seg-label-light' }, `已确认并集 ${fmtInt(observed)}（实际看见）`));
  }
  if (missed !== null && wMiss > 0) {
    svg.append(s('rect', { x: wObs + 2, y: 4, width: wMiss, height: 28, rx: 4, class: 'seg-missed' }));
    if (wMiss > 110) {
      svg.append(s('text', { x: wObs + 12, y: 23, class: 'seg-label-dark' }, `漏登估计 ≈${fmt1(missed)}`));
    }
  }
  container.replaceChildren(svg);

  const legend = h('div', { class: 'seg-legend' },
    h('span', { class: 'seg-key' }, h('span', { class: 'swatch swatch-observed' }), `已确认并集 ${fmtInt(observed)} 台（实际看见的数量）`),
    missed === null
      ? h('span', { class: 'seg-key' }, h('span', { class: 'swatch swatch-missed' }), `漏登估计：当前模型（${modelName}）不可估`)
      : h('span', { class: 'seg-key' }, h('span', { class: 'swatch swatch-missed' }), `漏登估计 ≈${fmt1(missed)} 台（依赖假设的估计 · 模型：${modelName}）`),
  );
  container.append(legend);
}
