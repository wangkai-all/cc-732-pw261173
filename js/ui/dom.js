/** DOM 构建小工具：数据一律走 textContent，不拼接 innerHTML。 */

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  appendKids(node, children);
  return node;
}

function appendKids(node, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false || c === '') continue;
    if (Array.isArray(c)) appendKids(node, c);
    else if (c.nodeType) node.append(c);
    else node.append(document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  appendKids(node, children);
  return node;
}

/* ---------- 共享提示框（hover/focus 均可用；内容只走 textContent） ---------- */
let tipEl = null;

export function showTooltip(x, y, rows) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    document.body.append(tipEl);
  }
  tipEl.replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'tooltip-row';
    const v = document.createElement('strong');
    v.textContent = value;
    const l = document.createElement('span');
    l.textContent = label;
    row.append(v, l);
    tipEl.append(row);
  }
  tipEl.style.display = 'block';
  const pad = 12;
  const rect = tipEl.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
  tipEl.style.left = `${left + window.scrollX}px`;
  tipEl.style.top = `${top + window.scrollY}px`;
}

export function hideTooltip() {
  if (tipEl) tipEl.style.display = 'none';
}

/* ---------- 数字格式 ---------- */
export const fmtInt = (x) => Math.round(x).toLocaleString('zh-CN');
export const fmt1 = (x) => (Math.round(x * 10) / 10).toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmt2 = (x) => (Math.round(x * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
