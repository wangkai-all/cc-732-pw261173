/**
 * 核心模块测试（node tests/run-tests.mjs）。
 * 覆盖：名单整理、身份决议、重合表、对数线性模型拟合、不可估规则、数据集集成。
 */
import { strict as assert } from 'node:assert';
import { normalizeId, curateSource, resolveIdentities } from '../js/core/identity.js';
import { buildOverlap, CELL_ORDER } from '../js/core/overlap.js';
import { fitLogLinear, MODELS } from '../js/core/loglinear.js';
import { estimateAll } from '../js/core/estimate.js';
import { main as dsMain, contractor as dsContractor } from '../js/data/index.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exit(1);
  }
}

/* ---------- normalizeId ---------- */
test('normalizeId 只做外观规范化', () => {
  assert.equal(normalizeId(' pu-001 '), 'PU-001');
  assert.equal(normalizeId('ＰＵ-００１'), 'PU-001'); // 全角 → 半角
  assert.equal(normalizeId('PU 001'), 'PU001');      // 去空白
  assert.equal(normalizeId(''), '');
  assert.equal(normalizeId(null), '');
  // 不做语义合并：连字符、前导零、位数差异都保留
  assert.notEqual(normalizeId('PU001'), normalizeId('PU-001'));
  assert.notEqual(normalizeId('PU-14'), normalizeId('PU-014'));
});

/* ---------- curateSource ---------- */
test('名单整理：去重、剔除空编号与无效编号', () => {
  const src = {
    id: 'A',
    records: [
      { rawId: 'PU-001', date: '2026-09-01' },
      { rawId: 'PU-001', date: '2026-09-01' }, // 完全重复
      { rawId: 'pu-002', date: '2026-09-02' }, // 大小写差异 → 规范化后仍是同一台？否：仅外观规范化
      { rawId: '', date: '2026-09-03' },       // 空编号
      { rawId: '———', date: '2026-09-04' },   // 无有效字符
    ],
  };
  const { records, issues, rawCount } = curateSource(src);
  assert.equal(rawCount, 5);
  assert.equal(records.length, 2);
  assert.equal(records[1].normId, 'PU-002');
  assert.equal(issues.filter((i) => i.type === 'duplicate').length, 1);
  assert.equal(issues.filter((i) => i.type === 'dropped').length, 2);
});

/* ---------- resolveIdentities ---------- */
function curatedOf(recordsBySource) {
  return Object.entries(recordsBySource).map(([id, records]) =>
    curateSource({ id, records: records.map((rawId) => ({ rawId })) }));
}

test('身份决议：编号精确匹配合并', () => {
  const res = resolveIdentities(
    curatedOf({ A: ['PU-001', 'PU-002'], B: ['PU-001'], C: [] }), [], [], {},
  );
  assert.equal(res.devices.size, 2);
  assert.deepEqual([...res.devices.get('PU-001').sources].sort(), ['A', 'B']);
});

test('身份决议：已确认别名自动应用', () => {
  const res = resolveIdentities(
    curatedOf({ A: ['PU-001'], B: ['P-001'], C: [] }),
    [{ from: 'P-001', to: 'PU-001', basis: '测试' }], [], {},
  );
  assert.equal(res.devices.size, 1);
  assert.deepEqual([...res.devices.get('PU-001').sources].sort(), ['A', 'B']);
});

test('身份决议：疑似同名在未决定时不合并', () => {
  const pending = [{ id: 'pa1', pair: ['PU-014', 'PU-14'] }];
  const base = resolveIdentities(
    curatedOf({ A: ['PU-014'], C: ['PU-14'] }), [], pending, {},
  );
  assert.equal(base.devices.size, 2); // 未决 → 按分开处理
  const separate = resolveIdentities(
    curatedOf({ A: ['PU-014'], C: ['PU-14'] }), [], pending, { pa1: 'separate' },
  );
  assert.equal(separate.devices.size, 2);
  const merged = resolveIdentities(
    curatedOf({ A: ['PU-014'], C: ['PU-14'] }), [], pending, { pa1: 'merge' },
  );
  assert.equal(merged.devices.size, 1); // 只有明确「合并」才改变身份
  assert.deepEqual([...merged.devices.get('PU-014').sources].sort(), ['A', 'C']);
});

test('身份决议：规范名选取优先标准编号样式', () => {
  const res = resolveIdentities(
    curatedOf({ A: ['IN-0207'], C: ['IN-207'] }),
    [], [{ id: 'pa1', pair: ['IN-207', 'IN-0207'] }], { pa1: 'merge' },
  );
  assert.equal(res.devices.size, 1);
  assert.ok(res.devices.has('IN-207')); // 3 位数字的标准样式优先于 IN-0207
});

/* ---------- buildOverlap ---------- */
test('重合表：计数与重复捕获正确', () => {
  const res = resolveIdentities(
    curatedOf({ A: ['D-1', 'D-2', 'D-3'], B: ['D-1', 'D-2'], C: ['D-1'] }), [], [], {},
  );
  const overlap = buildOverlap(res.devices, ['A', 'B', 'C']);
  const count = (h) => overlap.cells.get(h).count;
  assert.equal(count('111'), 1); // D-1
  assert.equal(count('110'), 1); // D-2
  assert.equal(count('100'), 1); // D-3
  assert.equal(overlap.observedUnion, 3);
  assert.equal(overlap.recaptures, 2);
  assert.deepEqual(overlap.counts7, [1, 1, 0, 1, 0, 0, 0]);
});

/* ---------- fitLogLinear ---------- */
test('拟合：独立模型在精确独立表上还原 n000', () => {
  // 精确独立：N=1000，三名单各占 1/2 → 每格 125
  const counts7 = [125, 125, 125, 125, 125, 125, 125];
  const fit = fitLogLinear(counts7, ['intercept', 'A', 'B', 'C']);
  assert.equal(fit.status, 'ok');
  assert.ok(Math.abs(fit.n000 - 125) < 1e-6, `n000=${fit.n000}`);
  assert.ok(fit.deviance < 1e-6);
  assert.equal(fit.df, 3);
});

test('拟合：饱和模型精确复现观测格', () => {
  const counts7 = [16, 23, 21, 29, 13, 15, 11];
  const terms = MODELS.find((m) => m.id === 'AB.AC.BC').terms;
  const fit = fitLogLinear(counts7, terms);
  assert.equal(fit.status, 'ok');
  assert.equal(fit.df, 0);
  for (let i = 0; i < 7; i++) {
    assert.ok(Math.abs(fit.mu[i] - counts7[i]) < 1e-6, `cell ${i}: mu=${fit.mu[i]}`);
  }
});

test('拟合：拒绝非负整数以外的计数', () => {
  assert.equal(fitLogLinear([1, 2, 3, 4, 5, 6, -1], ['intercept', 'A']).status, 'invalid');
  assert.equal(fitLogLinear([1, 2, 3, 4, 5, 6, 0.5], ['intercept', 'A']).status, 'invalid');
  assert.equal(fitLogLinear([1, 2, 3], ['intercept', 'A']).status, 'invalid');
});

test('拟合：参数数超过观测格 → 不可辨识', () => {
  const fit = fitLogLinear([1, 1, 1, 1, 1, 1, 1], MODELS.find((m) => m.id === 'ABC').terms);
  assert.equal(fit.status, 'unidentifiable');
});

test('拟合：空格导致参数无有限解 → 不可估', () => {
  // 饱和模型下 111 格为 0 → 交互参数趋向 -∞
  const counts7 = [0, 23, 21, 29, 13, 15, 11];
  const terms = MODELS.find((m) => m.id === 'AB.AC.BC').terms;
  const fit = fitLogLinear(counts7, terms);
  assert.equal(fit.status, 'inestimable');
  assert.match(fit.reason, /有限解/);
});

/* ---------- estimateAll 全局规则 ---------- */
test('估计：重合为零 → 全部模型不可估', () => {
  const counts7 = [0, 0, 0, 30, 0, 25, 20]; // 只有单来源设备
  const est = estimateAll(counts7);
  for (const r of est.results) {
    assert.notEqual(r.status, 'ok', `${r.model.id} 不应可估`);
  }
  assert.match(est.results.find((r) => r.model.id === 'indep').reason, /重合/);
});

test('估计：无设备 → 全部模型不可估', () => {
  const est = estimateAll([0, 0, 0, 0, 0, 0, 0]);
  for (const r of est.results) assert.notEqual(r.status, 'ok');
});

test('估计：数据过稀给出警告但仍报告可估模型的结果', () => {
  const counts7 = [2, 0, 3, 30, 0, 25, 20]; // 有空格但重复捕获 = 5
  const est = estimateAll(counts7);
  assert.ok(est.warnings.some((w) => w.includes('数据过稀')));
  assert.equal(est.results.find((r) => r.model.id === 'indep').status, 'ok');
});

test('估计：重复捕获不足 3 台 → 数据过稀，全部模型不可估', () => {
  const counts7 = [1, 0, 1, 40, 0, 30, 20]; // 重复捕获 = 2
  const est = estimateAll(counts7);
  for (const r of est.results) assert.notEqual(r.status, 'ok', `${r.model.id} 不应可估`);
  assert.match(est.results.find((r) => r.model.id === 'indep').reason, /数据过稀/);
});

test('估计：三因子交互模型始终标记不可辨识', () => {
  const est = estimateAll([16, 23, 21, 29, 13, 15, 11]);
  const abc = est.results.find((r) => r.model.id === 'ABC');
  assert.equal(abc.status, 'unidentifiable');
  assert.match(abc.reason, /未观测/);
});

test('估计：已确认并集与漏登估计分开报告', () => {
  const est = estimateAll([16, 23, 21, 29, 13, 15, 11]);
  assert.equal(est.observedUnion, 128);
  const indep = est.results.find((r) => r.model.id === 'indep');
  assert.equal(indep.status, 'ok');
  assert.ok(Math.abs(indep.total - (est.observedUnion + indep.n000)) < 1e-9);
});

/* ---------- 数据集集成 ---------- */
function pipeline(dataset, decisions = {}) {
  const curated = dataset.sources.map(curateSource);
  const resolution = resolveIdentities(curated, dataset.confirmedAliases, dataset.pendingAliases, decisions);
  const overlap = buildOverlap(resolution.devices, dataset.sources.map((s) => s.id));
  return { curated, resolution, overlap, estimation: estimateAll(overlap.counts7) };
}

test('集成（主数据集）：管线贯通，独立模型估计接近虚构真值', () => {
  const { overlap, estimation } = pipeline(dsMain);
  assert.ok(overlap.counts7.every((c) => c >= 4));
  const indep = estimation.results.find((r) => r.model.id === 'indep');
  assert.equal(indep.status, 'ok');
  assert.ok(Math.abs(indep.n000 - dsMain.truth.missedByAll) <= 8,
    `n000=${indep.n000.toFixed(1)} vs 真值 ${dsMain.truth.missedByAll}`);
});

test('集成（主数据集）：待定别名的决定改变重合表与估计', () => {
  const before = pipeline(dsMain, {});
  const after = pipeline(dsMain, { pa1: 'merge', pa2: 'merge', pa3: 'merge', pa4: 'separate' });
  assert.notDeepEqual(before.overlap.counts7, after.overlap.counts7);
  // 三对真实别名合并后，并集减少 3
  assert.equal(after.overlap.observedUnion, before.overlap.observedUnion - 3);
});

test('集成（反例）：共用承包商 → 独立模型低估，AB.C 更接近真值', () => {
  const { estimation } = pipeline(dsContractor);
  const indep = estimation.results.find((r) => r.model.id === 'indep');
  const abc = estimation.results.find((r) => r.model.id === 'AB.C');
  assert.equal(indep.status, 'ok');
  assert.equal(abc.status, 'ok');
  const truth = dsContractor.truth.missedByAll;
  assert.ok(indep.n000 < truth - 2, `独立模型应明显低估：${indep.n000.toFixed(1)} vs ${truth}`);
  assert.ok(Math.abs(abc.n000 - truth) < Math.abs(indep.n000 - truth),
    'AB.C 应比独立模型更接近真值');
});

console.log(`\n${passed} 个测试全部通过。`);
