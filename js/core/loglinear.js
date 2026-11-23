/**
 * 对数线性模型拟合（捕获-再捕获，三名单 → 2×2×2 表，000 格不可观测）。
 *
 * 方法：把 7 个可观测格视为 Poisson 计数，对对数线性模型做 IRLS 拟合，
 * 再外推未观测格 n000 = exp(设计行(000)·β)。总数估计 = 已确认并集 + n000。
 *
 * 硬性规则：
 *  - 计数必须为非负整数，否则拒绝拟合；
 *  - 参数数 > 7（观测格数）→ 不可辨识；
 *  - 设计矩阵秩不足 → 不可辨识；
 *  - 极大似然估计发散（|β| 无界）→ 不可估（参数无有限解）。
 */
import { CELL_ORDER } from './overlap.js';

const BITS = Object.fromEntries(
  [...CELL_ORDER, '000'].map((h) => [h, h.split('').map(Number)]),
);

const TERM_FNS = {
  intercept: () => 1,
  A: ([a]) => a,
  B: ([, b]) => b,
  C: ([, , c]) => c,
  AB: ([a, b]) => a * b,
  AC: ([a, , c]) => a * c,
  BC: ([, b, c]) => b * c,
  ABC: ([a, b, c]) => a * b * c,
};

/** 可比较的模型族。交互项必须显式声明；三因子交互不可辨识（作为说明性条目保留）。 */
export const MODELS = [
  {
    id: 'indep', name: '相互独立', formula: 'A + B + C',
    terms: ['intercept', 'A', 'B', 'C'],
    assumption: '无交互项：假设三份名单的覆盖相互独立。',
  },
  {
    id: 'AB.C', name: 'A·B 相关', formula: 'A*B + C',
    terms: ['intercept', 'A', 'B', 'C', 'AB'],
    assumption: '交互项 AB：允许名单 A 与 B 的覆盖相关，C 与二者独立。',
  },
  {
    id: 'AC.B', name: 'A·C 相关', formula: 'A*C + B',
    terms: ['intercept', 'A', 'B', 'C', 'AC'],
    assumption: '交互项 AC：允许名单 A 与 C 的覆盖相关，B 与二者独立。',
  },
  {
    id: 'BC.A', name: 'B·C 相关', formula: 'B*C + A',
    terms: ['intercept', 'A', 'B', 'C', 'BC'],
    assumption: '交互项 BC：允许名单 B 与 C 的覆盖相关，A 与二者独立。',
  },
  {
    id: 'AB.AC', name: 'A·B、A·C 相关', formula: 'A*B + A*C',
    terms: ['intercept', 'A', 'B', 'C', 'AB', 'AC'],
    assumption: '交互项 AB、AC。',
  },
  {
    id: 'AB.BC', name: 'A·B、B·C 相关', formula: 'A*B + B*C',
    terms: ['intercept', 'A', 'B', 'C', 'AB', 'BC'],
    assumption: '交互项 AB、BC。',
  },
  {
    id: 'AC.BC', name: 'A·C、B·C 相关', formula: 'A*C + B*C',
    terms: ['intercept', 'A', 'B', 'C', 'AC', 'BC'],
    assumption: '交互项 AC、BC。',
  },
  {
    id: 'AB.AC.BC', name: '全部两两相关', formula: 'A*B + A*C + B*C',
    terms: ['intercept', 'A', 'B', 'C', 'AB', 'AC', 'BC'],
    assumption: '交互项 AB、AC、BC：对 7 个观测格饱和，仅剩「无三因子交互」一个假设。',
  },
  {
    id: 'ABC', name: '含三因子交互（饱和）', formula: 'A*B*C',
    terms: ['intercept', 'A', 'B', 'C', 'AB', 'AC', 'BC', 'ABC'],
    unidentifiable: true,
    reason: '三因子交互共需 8 个参数，但可观测的只有 7 个格子（三份名单都未出现的设备不可数）。'
      + '该模型不可辨识——这正是「未观测组合不能从数据中直接验证」的代数形式。',
  },
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

/** 高斯消元（部分主元）解 Ax=b；奇异时返回 null。 */
function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/**
 * 拟合一个对数线性模型。
 * @param counts7 7 个观测格计数（顺序见 CELL_ORDER），必须为非负整数
 * @param terms   模型项，如 ['intercept','A','B','C','AB']
 * @returns { status: 'ok', beta, mu, n000, deviance, df, p }
 *       或 { status: 'invalid' | 'unidentifiable' | 'inestimable', reason }
 */
export function fitLogLinear(counts7, terms) {
  // —— 输入校验：非负整数计数 ——
  if (
    !Array.isArray(counts7) || counts7.length !== 7
    || !counts7.every((c) => Number.isInteger(c) && c >= 0)
  ) {
    return { status: 'invalid', reason: '拟合要求 7 个观测格的非负整数计数。' };
  }
  const p = terms.length;
  // —— 可辨识检查 1：参数数不能超过观测格数 ——
  if (p > 7) {
    return { status: 'unidentifiable', reason: `模型含 ${p} 个参数，超过 7 个观测格，不可辨识。` };
  }

  const X = CELL_ORDER.map((h) => terms.map((t) => TERM_FNS[t](BITS[h])));
  const row000 = terms.map((t) => TERM_FNS[t](BITS['000']));
  const y = counts7;

  // 初值：对 log(y+0.5) 做最小二乘
  const XtX = X[0].map((_, j) => X[0].map((_, k) => X.reduce((s, row) => s + row[j] * row[k], 0)));
  const Xty = X[0].map((_, j) => X.reduce((s, row, i) => s + row[j] * Math.log(y[i] + 0.5), 0));
  let beta = solve(XtX, Xty);
  if (!beta) return { status: 'unidentifiable', reason: '设计矩阵秩不足，参数不可辨识。' };

  // —— IRLS（Poisson，对数连接）——
  let converged = false;
  let mu = null;
  for (let iter = 0; iter < 200; iter++) {
    const eta = X.map((row) => dot(row, beta));
    mu = eta.map((e) => Math.exp(clamp(e, -30, 30)));
    const z = eta.map((e, i) => e + (y[i] - mu[i]) / Math.max(mu[i], 1e-10));
    const XtWX = X[0].map((_, j) =>
      X[0].map((_, k) => X.reduce((s, row, i) => s + row[j] * mu[i] * row[k], 0)));
    const XtWz = X[0].map((_, j) => X.reduce((s, row, i) => s + row[j] * mu[i] * z[i], 0));
    const betaNew = solve(XtWX, XtWz);
    // —— 可辨识检查 2：加权设计矩阵秩 ——
    if (!betaNew) return { status: 'unidentifiable', reason: '设计矩阵秩不足，参数不可辨识。' };
    // —— 有限解检查：参数发散（空格/完全分离的典型表现）——
    if (betaNew.some((b) => !Number.isFinite(b) || Math.abs(b) > 25)) {
      return { status: 'inestimable', reason: '参数无有限解（极大似然估计发散，通常由空格或完全分离导致）。' };
    }
    const delta = Math.max(...betaNew.map((b, i) => Math.abs(b - beta[i])));
    beta = betaNew;
    if (delta < 1e-10) { converged = true; break; }
  }
  if (!converged) return { status: 'inestimable', reason: '迭代未收敛，无有限解。' };

  // —— 外推未观测格 000 ——
  const eta000 = dot(row000, beta);
  if (!Number.isFinite(eta000) || eta000 > 30) {
    return { status: 'inestimable', reason: '未观测格的估计无有限界。' };
  }
  const n000 = Math.exp(eta000);
  if (!Number.isFinite(n000) || n000 < 0) {
    return { status: 'inestimable', reason: '未观测格估计不是有限的非负数。' };
  }

  // 偏差 G²（仅衡量对 7 个观测格的拟合，不能验证未观测格）
  let deviance = 0;
  for (let i = 0; i < 7; i++) {
    if (y[i] > 0) deviance += 2 * (y[i] * Math.log(y[i] / mu[i]) - (y[i] - mu[i]));
    else deviance += 2 * mu[i];
  }
  return { status: 'ok', beta, mu, n000, deviance, df: 7 - p, p };
}
