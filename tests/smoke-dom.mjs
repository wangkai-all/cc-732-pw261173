/**
 * UI 冒烟测试：用最小 DOM 垫片在 Node 中实际执行 app.js 的渲染与交互。
 * 不是浏览器替代品——只验证渲染管线不抛异常、关键区块有内容、交互会触发重算。
 */
import { strict as assert } from 'node:assert';

/* ---------------- 最小 DOM 垫片 ---------------- */
class TextNode {
  constructor(text) { this.nodeType = 3; this.textContent = text; }
}

class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this._class = '';
    this.parentNode = null;
  }
  get className() { return this._class; }
  set className(v) { this._class = v; }
  get classList() {
    const self = this;
    const set = () => new Set(self._class.split(/\s+/).filter(Boolean));
    return {
      add: (c) => { const s = set(); s.add(c); self._class = [...s].join(' '); },
      remove: (c) => { const s = set(); s.delete(c); self._class = [...s].join(' '); },
      toggle: (c, force) => {
        const s = set();
        const want = force === undefined ? !s.has(c) : force;
        if (want) s.add(c); else s.delete(c);
        self._class = [...s].join(' ');
      },
      contains: (c) => set().has(c),
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this._class = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  append(...kids) {
    for (const k of kids) {
      const node = k && k.nodeType ? k : new TextNode(String(k));
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, evt = {}) {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, clientX: 0, clientY: 0, ...evt });
  }
  get textContent() {
    return this.children.map((c) => (c.nodeType === 3 ? c.textContent : c.textContent)).join('');
  }
  set textContent(v) { this.replaceChildren(new TextNode(String(v))); }
  getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; }
}

function matches(el, sel) {
  if (el.nodeType !== 1) return false;
  if (sel.startsWith('#')) return el.attributes.id === sel.slice(1);
  if (sel.startsWith('.')) return el._class.split(/\s+/).includes(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}

function* walk(node) {
  for (const c of node.children ?? []) {
    if (c.nodeType === 1) { yield c; yield* walk(c); }
  }
}

function querySelector(root, sel) {
  const parts = sel.trim().split(/\s+/);
  let candidates = [root];
  for (const part of parts) {
    const next = [];
    for (const c of candidates) {
      for (const el of walk(c)) if (matches(el, part)) next.push(el);
      if (matches(c, part) && c !== root) next.push(c);
    }
    candidates = next;
  }
  return candidates[0] ?? null;
}

function findByText(root, tag, text) {
  for (const el of walk(root)) {
    if (el.tagName === tag.toUpperCase() && el.textContent.includes(text)) return el;
  }
  return null;
}

/* ---------------- 搭建 index.html 需要的容器结构 ---------------- */
function el(tag, attrs = {}) {
  const node = new El(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const body = el('body');
const containers = {};
for (const id of ['dataset-tabs', 'dataset-desc', 'venn-container', 'venn-legend', 'device-panel',
  'est-warnings', 'dataset-notes', 'est-tiles', 'truth-note', 'seg-container', 'model-bars']) {
  containers[id] = el('div', { id });
  body.append(containers[id]);
}
for (const sec of ['sec-curation', 'sec-identity', 'sec-impact']) {
  const section = el('section', { id: sec });
  const bodyEl = el('div', { class: 'section-body' });
  section.append(bodyEl);
  body.append(section);
  containers[`${sec}-body`] = bodyEl;
}
for (const tbl of ['overlap-table', 'model-table']) {
  const table = el('table', { id: tbl });
  const tbody = el('tbody');
  table.append(tbody);
  body.append(table);
  containers[`${tbl}-tbody`] = tbody;
}

globalThis.document = {
  body,
  createElement: (tag) => new El(tag),
  createElementNS: (ns, tag) => new El(tag),
  createTextNode: (t) => new TextNode(t),
  querySelector: (sel) => querySelector(body, sel),
};
globalThis.window = { innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0 };

/* ---------------- 执行应用并断言 ---------------- */
await import('../js/ui/app.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }
  catch (err) { console.error(`FAIL ${name}`); console.error(err); process.exit(1); }
}

test('初始渲染：三个数字磁贴，已确认并集 128', () => {
  assert.equal(containers['est-tiles'].children.length, 3);
  assert.match(containers['est-tiles'].children[0].textContent, /128/);
});

test('初始渲染：模型表 9 行，三因子交互行不可辨识', () => {
  const rows = containers['model-table-tbody'].children;
  assert.equal(rows.length, 9);
  assert.match(rows[8].textContent, /不可辨识/);
  assert.match(rows[8].textContent, /未观测/);
});

test('初始渲染：重合表 8 行（7 观测格 + 未观测格）', () => {
  assert.equal(containers['overlap-table-tbody'].children.length, 8);
});

test('初始渲染：韦恩图与模型对比图均生成 SVG', () => {
  assert.equal(containers['venn-container'].children[0].tagName, 'svg'.toUpperCase());
  assert.equal(containers['model-bars'].children[0].tagName, 'svg'.toUpperCase());
});

test('初始渲染：影响分析给出范围', () => {
  assert.match(containers['sec-impact-body'].textContent, /影响范围/);
});

test('交互：合并一对待定别名后并集减 1、重合表即时变化', () => {
  const before = containers['est-tiles'].children[0].textContent;
  const btn = findByText(body, 'button', '合并为同一台');
  assert.ok(btn, '应找到合并按钮');
  btn.dispatch('click');
  const after = containers['est-tiles'].children[0].textContent;
  assert.match(before, /128/);
  assert.match(after, /127/);
});

test('交互：切换当前模型后磁贴标注模型名', () => {
  const row = containers['model-table-tbody'].children
    .find((tr) => tr.textContent.includes('A·B 相关'));
  assert.ok(row, '应找到 AB.C 模型行');
  row.dispatch('click');
  assert.match(containers['est-tiles'].children[1].textContent, /A·B 相关/);
});

test('交互：点击重合格查看设备明细', () => {
  const btn = findByText(containers['overlap-table-tbody'], 'button', '查看设备');
  assert.ok(btn, '应找到查看设备按钮');
  btn.dispatch('click');
  assert.match(containers['device-panel'].textContent, /台设备/);
  assert.ok(containers['device-panel'].textContent.includes('PU-') ||
    containers['device-panel'].textContent.includes('VA-') ||
    containers['device-panel'].textContent.includes('IN-'));
});

test('交互：切换到反例数据集，并集变为 88', () => {
  const tab = findByText(body, 'button', '北山水厂');
  assert.ok(tab, '应找到数据集切换按钮');
  tab.dispatch('click');
  assert.match(containers['est-tiles'].children[0].textContent, /88/);
  assert.match(containers['sec-impact-body'].textContent, /没有待定别名/);
});

test('反例数据集：独立模型低估、AB.C 接近虚构真值', () => {
  const rows = containers['model-table-tbody'].children;
  const indep = rows.find((tr) => tr.textContent.includes('相互独立'));
  const abc = rows.find((tr) => tr.textContent.includes('A·B 相关'));
  assert.match(indep.textContent, /≈6\./);
  assert.match(abc.textContent, /≈12\./);
});

console.log(`\n${passed} 个冒烟测试全部通过。`);
