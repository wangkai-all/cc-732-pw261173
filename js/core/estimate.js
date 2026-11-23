/**
 * 总体估计编排：对全部模型跑拟合，套用全局不可估规则，汇总警告。
 *
 * 已确认并集（observedUnion）是实际看见的数量；
 * 漏登量（n000）是依赖模型假设的估计。两者在输出中始终分开。
 */
import { MODELS, fitLogLinear } from './loglinear.js';

/**
 * @param counts7 7 个观测格计数
 * @returns { results, warnings, observedUnion, recaptures }
 */
export function estimateAll(counts7) {
  const observedUnion = counts7.reduce((a, b) => a + b, 0);
  // 重复捕获：111、110、101、011 四格
  const recaptures = counts7[0] + counts7[1] + counts7[2] + counts7[4];
  const warnings = [];

  // —— 全局不可估规则 ——
  let globalRule = null;
  if (observedUnion === 0) {
    globalRule = '三份名单合并后没有任何设备，无数据可估。';
  } else if (recaptures === 0) {
    globalRule = '三份名单之间没有任何重合设备（重复捕获为 0）：数据中不含任何关于重合结构的信息，'
      + '任何漏登数字都完全来自模型假设，报告为不可估。';
  } else if (recaptures < 3) {
    globalRule = `数据过稀：重复捕获（出现在 ≥2 份名单的设备）仅 ${recaptures} 台，`
      + '不足以支撑任何模型的外推，报告为不可估。';
  }

  // —— 稀疏与薄弱数据警告 ——
  const zeroCells = counts7.filter((c) => c === 0).length;
  if (zeroCells > 0) {
    warnings.push(`数据过稀：${zeroCells} 个观测格计数为 0，部分模型的参数可能无有限解（此时相应模型报告不可估）。`);
  }
  if (!globalRule && recaptures < 5) {
    warnings.push(`重复捕获仅 ${recaptures} 台：重合信息极少，估计对模型假设极为敏感。`);
  }

  const results = MODELS.map((model) => {
    if (model.unidentifiable) {
      return { model, status: 'unidentifiable', reason: model.reason };
    }
    if (globalRule) {
      return { model, status: 'inestimable', reason: globalRule };
    }
    const fit = fitLogLinear(counts7, model.terms);
    if (fit.status !== 'ok') return { model, ...fit };
    return {
      model,
      status: 'ok',
      n000: fit.n000,
      total: observedUnion + fit.n000,
      deviance: fit.deviance,
      df: fit.df,
      p: fit.p,
      saturated: fit.df === 0,
    };
  });

  return { results, warnings, observedUnion, recaptures };
}

/** 取某个模型的结果。 */
export function modelResult(estimation, modelId) {
  return estimation.results.find((r) => r.model.id === modelId);
}
