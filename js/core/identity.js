/**
 * 名单整理与身份决议。
 *
 * 原则：疑似同名绝不自动合并。
 * 只有两类信息会改变设备身份：
 *   1) confirmedAliases —— 设备科已确认的别名对照（自动应用）；
 *   2) 用户在待定别名（pendingAliases）上明确选择「合并」。
 * normalizeId 只做外观处理：全半角、大小写、空白，不做任何语义合并。
 */

/** 外观规范化：全角→半角、去空白、统一大写。 */
export function normalizeId(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  // 全角英数符号 → 半角
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // 去掉所有空白字符（含全角空格 U+3000）
  s = s.replace(/\s+/g, '');
  return s.toUpperCase();
}

/**
 * 名单整理（单来源）：
 *  - 剔除空编号 / 无有效字符的记录；
 *  - 同一名单内同一规范化编号重复出现 → 保留第一条，其余记为重复。
 * 返回 { sourceId, records, issues, rawCount }。
 */
export function curateSource(source) {
  const issues = [];
  const records = [];
  const seen = new Map();
  for (const rec of source.records) {
    const normId = normalizeId(rec.rawId);
    if (!normId) {
      issues.push({ type: 'dropped', summary: '编号为空，记录剔除', rawId: rec.rawId });
      continue;
    }
    if (!/[A-Z0-9]/.test(normId)) {
      issues.push({ type: 'dropped', summary: `编号「${rec.rawId}」不含有效字符，记录剔除`, rawId: rec.rawId });
      continue;
    }
    if (seen.has(normId)) {
      issues.push({ type: 'duplicate', summary: `「${normId}」在本名单内重复出现，保留第一条`, rawId: rec.rawId });
      continue;
    }
    seen.set(normId, rec);
    records.push({ ...rec, normId, sourceId: source.id });
  }
  return { sourceId: source.id, records, issues, rawCount: source.records.length };
}

class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  add(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x) {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = x;
    while (this.parent.get(cur) !== cur) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

/** 设备科标准编号样式：2-4 位字母 + 连字符 + 恰好 3 位数字，如 PU-014。 */
const STANDARD_ID = /^[A-Z]{2,4}-\d{3}$/;

/**
 * 身份决议：把三份名单的记录按「设备编号 + 已确认别名 + 已决定的待定别名」归并成设备。
 *
 * @param curatedList  curateSource 的结果数组
 * @param confirmedAliases  [{ from, to, basis }] 已确认别名（自动应用）
 * @param pendingAliases    [{ id, pair: [x, y], ... }] 待定别名
 * @param decisions         { pendingId: 'merge' | 'separate' }，缺省视为未决（按分开处理）
 * @returns { devices, appliedConfirmed, appliedPending, notes }
 *   devices: Map(canonicalId → { id, members, records, sources })
 */
export function resolveIdentities(curatedList, confirmedAliases, pendingAliases, decisions = {}) {
  const uf = new UnionFind();
  for (const src of curatedList) {
    for (const rec of src.records) uf.add(rec.normId);
  }

  const appliedConfirmed = [];
  for (const al of confirmedAliases ?? []) {
    const from = normalizeId(al.from);
    const to = normalizeId(al.to);
    uf.union(from, to);
    appliedConfirmed.push({ ...al, from, to });
  }

  const appliedPending = [];
  for (const pa of pendingAliases ?? []) {
    if (decisions[pa.id] === 'merge') {
      const [x, y] = pa.pair.map(normalizeId);
      uf.union(x, y);
      appliedPending.push(pa.id);
    }
  }

  const groups = new Map(); // root → { members:Set, records:[] }
  for (const src of curatedList) {
    for (const rec of src.records) {
      const root = uf.find(rec.normId);
      if (!groups.has(root)) groups.set(root, { members: new Set(), records: [] });
      const g = groups.get(root);
      g.members.add(rec.normId);
      g.records.push(rec);
    }
  }

  const devices = new Map();
  const notes = [];
  for (const g of groups.values()) {
    const members = [...g.members].sort();
    const canonical = chooseCanonical(members, g.records);
    const sources = new Set(g.records.map((r) => r.sourceId));
    // 同一设备在同一来源内以多个编号出现 → 记入说明
    const bySource = new Map();
    for (const r of g.records) {
      if (!bySource.has(r.sourceId)) bySource.set(r.sourceId, new Set());
      bySource.get(r.sourceId).add(r.normId);
    }
    for (const [sid, ids] of bySource) {
      if (ids.size > 1) {
        notes.push(`设备 ${canonical} 在名单 ${sid} 内以多个编号出现（${[...ids].sort().join('、')}），已按别名归并`);
      }
    }
    devices.set(canonical, { id: canonical, members, records: g.records, sources });
  }
  return { devices, appliedConfirmed, appliedPending, notes };
}

/** 规范名选取：优先标准编号样式，其次出现次数多，最后按字典序（保证确定性）。 */
function chooseCanonical(members, records) {
  const count = new Map(members.map((m) => [m, 0]));
  for (const r of records) count.set(r.normId, (count.get(r.normId) ?? 0) + 1);
  return members.slice().sort((a, b) => {
    const sa = STANDARD_ID.test(a) ? 0 : 1;
    const sb = STANDARD_ID.test(b) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (count.get(b) !== count.get(a)) return count.get(b) - count.get(a);
    return a < b ? -1 : a > b ? 1 : 0;
  })[0];
}
