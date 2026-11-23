/**
 * 虚构数据生成器（固定种子，可复现）。
 *
 * 生成两份完全虚构的数据集：
 *   1) main       云峰化工园区 2 号动力站 —— 三份名单近似独立的主数据集；
 *   2) contractor 北山水厂 —— 反例：名单 A、B 共用同一承包商，覆盖强相关。
 *
 * 生成后用核心模块自检统计性质并打印摘要，失败时非零退出。
 * 输出：js/data/dataset-main.js、js/data/dataset-contractor.js、js/data/index.js
 *
 * 本数据不对应任何真实资产系统。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curateSource, resolveIdentities } from '../js/core/identity.js';
import { buildOverlap, CELL_ORDER } from '../js/core/overlap.js';
import { estimateAll } from '../js/core/estimate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- 随机数（mulberry32，确定性） ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- 数据集 1：云峰化工园区 2 号动力站 ---------------- */
function buildMainDataset() {
  const rng = mulberry32(20261123);

  const TYPES = [
    { prefix: 'PU', base: '原料输送泵', from: 1, to: 24, pad: 3, locations: ['泵房一层', '泵房二层'], models: ['IH80-65-160', 'IH100-80-125'] },
    { prefix: 'VA', base: '切断阀', from: 101, to: 130, pad: 3, locations: ['管廊A段', '管廊B段', '罐区东侧'], models: ['Q941F-16C', 'Z41H-25'] },
    { prefix: 'MO', base: '搅拌机电机', from: 1, to: 20, pad: 3, locations: ['反应车间二层', '反应车间三层'], models: ['YE3-160M-4', 'YE3-180L-6'] },
    { prefix: 'IN', base: '压力变送器', from: 201, to: 236, pad: 3, locations: ['管廊A段', '反应车间二层', '罐区东侧'], models: ['EJA530E', '罗斯蒙特3051'] },
    { prefix: 'HE', base: '换热器', from: 1, to: 16, pad: 3, locations: ['换热站'], models: ['BR0.5-30', 'BR0.8-50'] },
    { prefix: 'CP', base: '氢气压缩机', from: 1, to: 8, pad: 3, locations: ['压缩机厂房'], models: ['ZW-3.2/10-16'] },
    { prefix: 'TN', base: '中间储罐', from: 1, to: 6, pad: 3, locations: ['罐区东侧', '罐区西侧'], models: ['50m³立式', '30m³卧式'] },
  ];

  const devices = [];
  for (const t of TYPES) {
    for (let n = t.from; n <= t.to; n++) {
      const seq = n - t.from + 1;
      devices.push({
        id: `${t.prefix}-${String(n).padStart(t.pad, '0')}`,
        name: `${seq}号${t.base}`,
        location: pick(rng, t.locations),
        model: pick(rng, t.models),
      });
    }
  }
  // VA-102A：VA-102 的并联备用阀，是一台真实存在的独立设备（待定别名「应分开」的素材）
  devices.push({ id: 'VA-102A', name: '2号切断阀（并联备用）', location: '管廊C段', model: 'Q941F-16C' });

  // 独立捕获概率：A 0.62 / B 0.52 / C 0.42
  const P = { A: 0.62, B: 0.52, C: 0.42 };
  const captured = new Map(); // id → Set(source)
  for (const d of devices) {
    const s = new Set();
    for (const sid of ['A', 'B', 'C']) if (rng() < P[sid]) s.add(sid);
    captured.set(d.id, s);
  }
  // 待定别名涉及设备的强制覆盖（保证判定会改变重合表）
  const force = (id, sids) => { captured.set(id, new Set(sids)); };
  force('PU-014', ['A', 'B', 'C']);   // C 写作 PU-14（同一台）
  force('MO-013', ['A', 'B']);        // B 写作 MO-33（同一台）
  force('IN-207', ['A', 'C']);        // A 写作 IN-0207（同一台）
  force('VA-102', ['A', 'B']);        // 与 VA-102A 是不同设备
  force('VA-102A', ['C']);

  // 已确认别名：B 用旧编号（只留首字母），C 漏写连字符
  const eligibleForB = devices.filter((d) => {
    const s = captured.get(d.id);
    return s.has('B') && s.size >= 2 && !['PU-014', 'MO-013', 'IN-207', 'VA-102', 'VA-102A'].includes(d.id);
  });
  const bAliasDevices = shuffle(rng, eligibleForB).slice(0, 8);
  const eligibleForC = devices.filter((d) => {
    const s = captured.get(d.id);
    return s.has('C') && s.size >= 2 && !bAliasDevices.includes(d)
      && !['PU-014', 'MO-013', 'IN-207', 'VA-102', 'VA-102A'].includes(d.id);
  });
  const cAliasDevices = shuffle(rng, eligibleForC).slice(0, 5);

  const oldStyle = (id) => id.replace(/^([A-Z])[A-Z]+-/, '$1-'); // PU-012 → P-012
  const confirmedAliases = [
    ...bAliasDevices.map((d) => ({ from: oldStyle(d.id), to: d.id, basis: '设备科《编号对照表》（2026-04 确认）' })),
    ...cAliasDevices.map((d) => ({ from: d.id.replace('-', ''), to: d.id, basis: '设备科《编号对照表》（2026-04 确认）' })),
  ];

  // 记录生成
  const INSPECTORS = {
    A: ['王建国', '李秀兰', '赵永强'],
    B: ['顺安机电·甲班', '顺安机电·乙班'],
    C: ['市特检院·检验员05', '市特检院·检验员07'],
  };
  const WINDOW = { A: ['2026-09-05', 24], B: ['2026-08-11', 12], C: ['2026-10-09', 13] };
  const randDate = (sid) => {
    const [start, span] = WINDOW[sid];
    const d = new Date(start);
    d.setDate(d.getDate() + Math.floor(rng() * span));
    return d.toISOString().slice(0, 10);
  };

  const rawIdFor = (dev, sid) => {
    // 待定别名的特殊写法
    if (dev.id === 'PU-014' && sid === 'C') return 'PU-14';
    if (dev.id === 'MO-013' && sid === 'B') return 'MO-33';
    if (dev.id === 'IN-207' && sid === 'A') return 'IN-0207';
    // 已确认别名的写法
    if (sid === 'B' && bAliasDevices.includes(dev)) return oldStyle(dev.id);
    if (sid === 'C' && cAliasDevices.includes(dev)) return dev.id.replace('-', '');
    return dev.id;
  };

  const sources = [
    { id: 'A', name: '运维部日常巡检', records: [] },
    { id: 'B', name: '承包商季度巡检（顺安机电）', records: [] },
    { id: 'C', name: '年度安全检验（市特检院）', records: [] },
  ];
  for (const dev of devices) {
    for (const sid of captured.get(dev.id)) {
      sources.find((s) => s.id === sid).records.push({
        rawId: rawIdFor(dev, sid),
        name: dev.name,
        location: dev.location,
        model: dev.model,
        date: randDate(sid),
        inspector: pick(rng, INSPECTORS[sid]),
      });
    }
  }

  // 名单整理素材：A 两条完全重复、B 一条空编号、C 一条无效编号
  const dupA = sources[0].records.filter((r) => r.rawId.includes('-')).slice(0, 2);
  for (const r of dupA) sources[0].records.push({ ...r });
  sources[1].records.push({ rawId: '', name: '（空白行）', location: '泵房一层', model: '', date: '2026-08-15', inspector: '顺安机电·甲班' });
  sources[2].records.push({ rawId: '———', name: '（编号无法辨认）', location: '罐区东侧', model: '', date: '2026-10-12', inspector: '市特检院·检验员05' });

  const missedByAll = devices.filter((d) => captured.get(d.id).size === 0).length;
  return {
    id: 'main',
    name: '云峰化工园区 2 号动力站',
    description: '三个来源各自提交一份巡检名单：运维部日常巡检、承包商季度巡检、年度安全检验。'
      + '三份名单的覆盖近似相互独立（虚构设定）。',
    truth: {
      totalDevices: devices.length,
      missedByAll,
      note: '虚构数据的真实总数（生成时已知）。仅用于演示假设对估计的影响，真实场景中这个数永远未知。',
    },
    sources,
    confirmedAliases,
    pendingAliases: [
      { id: 'pa1', pair: ['PU-014', 'PU-14'], note: '编号位数不同；名称、位置、型号一致。', truthSame: true },
      { id: 'pa2', pair: ['MO-013', 'MO-33'], note: '编号位数不同；名称、位置、型号一致。', truthSame: true },
      { id: 'pa3', pair: ['IN-207', 'IN-0207'], note: '一侧编号多一位前导零；名称、位置、型号一致。', truthSame: true },
      { id: 'pa4', pair: ['VA-102', 'VA-102A'], note: '编号仅差一个后缀字母；但安装位置不同（管廊A段 / 管廊C段）。', truthSame: false },
    ],
    notes: [],
  };
}

/* ---------------- 数据集 2（反例）：北山水厂，A、B 共用承包商 ---------------- */
function buildContractorDataset() {
  const rng = mulberry32(20260716);

  const TYPES = [
    { prefix: 'PU', base: '送水泵', from: 101, to: 130, locations: ['送水泵房', '净水车间'], models: ['KQW200-315', 'KQW150-280'] },
    { prefix: 'VA', base: '蝶阀', from: 101, to: 125, locations: ['净水车间', '配水井'], models: ['D341X-10', 'D371X-16'] },
    { prefix: 'IN', base: '浊度仪', from: 101, to: 120, locations: ['净水车间', '出水计量井'], models: ['1720E', 'TU5300'] },
    { prefix: 'DS', base: '加药装置', from: 101, to: 110, locations: ['加药间'], models: ['JY-500', 'JY-1000'] },
    { prefix: 'BL', base: '鼓风机', from: 101, to: 110, locations: ['鼓风机房'], models: ['BK5003', 'BK6008'] },
    { prefix: 'UV', base: '消毒设备', from: 101, to: 105, locations: ['消毒间'], models: ['UV-3200'] },
  ];
  // 偏远设备：A、B 共同的盲区（同一承包商的队伍不去的位置）
  const REMOTE_IDS = new Set([
    'VA-119', 'VA-120', 'VA-121', 'VA-122', 'VA-123', 'VA-124', 'VA-125',
    'IN-114', 'IN-115', 'IN-116', 'IN-117', 'IN-118', 'IN-119', 'IN-120',
    'BL-102', 'BL-103', 'BL-104', 'BL-105', 'BL-106', 'BL-107', 'BL-108', 'BL-109', 'BL-110',
    'UV-104', 'UV-105',
  ]);
  const REMOTE_LOCS = ['山顶水池', '管廊桥架', '取水口'];

  const devices = [];
  for (const t of TYPES) {
    for (let n = t.from; n <= t.to; n++) {
      const seq = n - t.from + 1;
      const id = `${t.prefix}-${n}`;
      const remote = REMOTE_IDS.has(id);
      devices.push({
        id,
        name: `${seq}号${t.base}`,
        location: remote ? REMOTE_LOCS[seq % REMOTE_LOCS.length] : pick(rng, t.locations),
        model: pick(rng, t.models),
        remote,
      });
    }
  }

  // A、B 同属承包商甲：对偏远设备同样低覆盖（强正相关）；C 为独立检验机构
  const captured = new Map();
  for (const d of devices) {
    const s = new Set();
    const pAB = d.remote ? 0.05 : null;
    if (rng() < (d.remote ? pAB : 0.78)) s.add('A');
    if (rng() < (d.remote ? pAB : 0.72)) s.add('B');
    if (rng() < 0.5) s.add('C');
    captured.set(d.id, s);
  }

  // 已确认别名：B 把连字符写成下划线（3 台，均被多来源覆盖）
  const eligible = devices.filter((d) => {
    const s = captured.get(d.id);
    return s.has('B') && s.size >= 2 && !d.remote;
  });
  const bAliasDevices = shuffle(rng, eligible).slice(0, 3);
  const confirmedAliases = bAliasDevices.map((d) => ({
    from: d.id.replace('-', '_'), to: d.id, basis: '水厂设备科口头确认（2026-08 会议纪要）',
  }));

  const INSPECTORS = {
    A: ['甲公司·巡检一组', '甲公司·巡检二组'],
    B: ['甲公司·维修班'],
    C: ['清源检测·检验员11', '清源检测·检验员12'],
  };
  const WINDOW = { A: ['2026-07-06', 18], B: ['2026-07-06', 18], C: ['2026-10-12', 12] };
  const randDate = (sid) => {
    const [start, span] = WINDOW[sid];
    const d = new Date(start);
    d.setDate(d.getDate() + Math.floor(rng() * span));
    return d.toISOString().slice(0, 10);
  };

  // C 有 4 条记录用全角编号（名单整理阶段的外观规范化即可处理，无需别名）
  const fullWidth = (id) => id.replace(/[A-Z0-9-]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
  const cFullWidthDevices = shuffle(rng, devices.filter((d) => captured.get(d.id).has('C'))).slice(0, 4);

  const sources = [
    { id: 'A', name: '日常巡检（承包商甲）', records: [] },
    { id: 'B', name: '维修记录（承包商甲）', records: [] },
    { id: 'C', name: '年度检验（清源检测）', records: [] },
  ];
  for (const dev of devices) {
    for (const sid of captured.get(dev.id)) {
      let rawId = dev.id;
      if (sid === 'B' && bAliasDevices.includes(dev)) rawId = dev.id.replace('-', '_');
      if (sid === 'C' && cFullWidthDevices.includes(dev)) rawId = fullWidth(dev.id);
      sources.find((s) => s.id === sid).records.push({
        rawId,
        name: dev.name,
        location: dev.location,
        model: dev.model,
        date: randDate(sid),
        inspector: pick(rng, INSPECTORS[sid]),
      });
    }
  }
  // 名单整理素材：A 一条完全重复、C 一条空编号
  sources[0].records.push({ ...sources[0].records[0] });
  sources[2].records.push({ rawId: '  ', name: '（空白行）', location: '净水车间', model: '', date: '2026-10-15', inspector: '清源检测·检验员11' });

  const missedByAll = devices.filter((d) => captured.get(d.id).size === 0).length;
  return {
    id: 'contractor',
    name: '北山水厂（反例：两来源共用承包商）',
    description: '名单 A（日常巡检）与名单 B（维修记录）来自同一承包商甲，巡检与维修由同一批人完成，'
      + '对偏远位置的设备存在共同盲区——两份名单的覆盖强正相关。名单 C 为独立检验机构。',
    truth: {
      totalDevices: devices.length,
      missedByAll,
      note: '虚构数据的真实总数（生成时已知）。仅用于演示假设对估计的影响，真实场景中这个数永远未知。',
    },
    sources,
    confirmedAliases,
    pendingAliases: [],
    notes: [
      '反例要点：名单 A 与 B 共用承包商甲，偏远设备（山顶水池、管廊桥架、取水口）被两份名单同时遗漏，'
        + '「相互独立」假设在此明显不成立。',
      '独立模型会把两名单的重合当作「覆盖率高」的证据，从而低估漏登量；'
        + '含 AB 交互项的模型允许 A、B 相关，给出的漏登估计明显更大、更接近虚构真值。',
      '但即便是含交互项的模型，仍依赖「无三因子交互」假设——未观测格永远无法从数据中直接验证。',
    ],
  };
}

/* ---------------- 输出序列化（记录每条一行，便于审阅） ---------------- */
function serializeDataset(d) {
  const src = d.sources.map((s) => {
    const recs = s.records.map((r) => `        ${JSON.stringify(r)}`).join(',\n');
    return `    { "id": ${JSON.stringify(s.id)}, "name": ${JSON.stringify(s.name)}, "records": [\n${recs}\n    ] }`;
  }).join(',\n');
  const json = (v) => JSON.stringify(v);
  return `// 虚构数据 —— 由 tools/generate-data.mjs 生成（固定种子），仅用于演示，不对应任何真实资产。
export default {
  id: ${json(d.id)},
  name: ${json(d.name)},
  description: ${json(d.description)},
  truth: ${json(d.truth)},
  sources: [
${src}
  ],
  confirmedAliases: ${json(d.confirmedAliases)},
  pendingAliases: ${json(d.pendingAliases)},
  notes: ${json(d.notes)}
};
`;
}

/* ---------------- 自检：跑完整管线，打印统计摘要 ---------------- */
function selfCheck(dataset, expectations) {
  const curated = dataset.sources.map(curateSource);
  const resolution = resolveIdentities(curated, dataset.confirmedAliases, dataset.pendingAliases, {});
  const overlap = buildOverlap(resolution.devices, dataset.sources.map((s) => s.id));
  const estimation = estimateAll(overlap.counts7);
  const get = (id) => estimation.results.find((r) => r.model.id === id);

  console.log(`\n== ${dataset.name} ==`);
  console.log(`已确认并集 ${overlap.observedUnion} / 虚构真值 ${dataset.truth.totalDevices}，`
    + `真值漏登 ${dataset.truth.missedByAll}，重复捕获 ${overlap.recaptures}`);
  console.log(`观测格 [${CELL_ORDER.join(' ')}] = [${overlap.counts7.join(' ')}]`);
  for (const r of estimation.results) {
    const v = r.status === 'ok' ? `n000=${r.n000.toFixed(1)} 总数=${r.total.toFixed(1)} G²=${r.deviance.toFixed(2)}` : `${r.status}`;
    console.log(`  ${r.model.id.padEnd(10)} ${v}`);
  }
  const failures = [];
  for (const [desc, ok] of expectations(overlap, estimation, dataset)) {
    if (!ok) failures.push(desc);
  }
  if (failures.length) {
    console.error(`自检失败：${failures.join('；')}`);
    process.exitCode = 1;
  } else {
    console.log('自检通过。');
  }
}

const main = buildMainDataset();
const contractor = buildContractorDataset();

selfCheck(main, (overlap, estimation, ds) => {
  const indep = estimation.results.find((r) => r.model.id === 'indep');
  return [
    ['全部观测格 ≥ 4', overlap.counts7.every((c) => c >= 4)],
    ['独立模型可估', indep.status === 'ok'],
    ['独立模型漏登估计在 5–35', indep.status === 'ok' && indep.n000 >= 5 && indep.n000 <= 35],
    ['真值漏登在 8–30', ds.truth.missedByAll >= 8 && ds.truth.missedByAll <= 30],
  ];
});

selfCheck(contractor, (overlap, estimation, ds) => {
  const indep = estimation.results.find((r) => r.model.id === 'indep');
  const abc = estimation.results.find((r) => r.model.id === 'AB.C');
  return [
    ['独立模型可估', indep.status === 'ok'],
    ['AB.C 模型可估', abc.status === 'ok'],
    ['独立模型明显低估漏登（比真值少 2 以上）', indep.status === 'ok' && indep.n000 <= ds.truth.missedByAll - 2],
    ['AB.C 明显高于独立模型（+2 以上）', indep.status === 'ok' && abc.status === 'ok' && abc.n000 >= indep.n000 + 2],
    ['AB.C 接近真值（±5）', abc.status === 'ok' && Math.abs(abc.n000 - ds.truth.missedByAll) <= 5],
  ];
});

if (process.exitCode) process.exit(1);

const outDir = join(ROOT, 'js', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'dataset-main.js'), serializeDataset(main));
writeFileSync(join(outDir, 'dataset-contractor.js'), serializeDataset(contractor));
writeFileSync(join(outDir, 'index.js'), `export { default as main } from './dataset-main.js';\nexport { default as contractor } from './dataset-contractor.js';\n`);
console.log('\n已写出 js/data/dataset-main.js、js/data/dataset-contractor.js、js/data/index.js');
