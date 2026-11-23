/**
 * 重合表（捕获历史列联表）。
 * 三份名单 → 每台设备的捕获历史是 3 位模式（1=该名单出现，0=未出现）。
 * 7 个可观测格 + 1 个不可观测格（000：三份名单都没出现的设备）。
 */

/** 7 个可观测格的固定顺序（二值模式降序，000 除外）。 */
export const CELL_ORDER = ['111', '110', '101', '100', '011', '010', '001'];

/** 全部 8 格（含不可观测的 000）。 */
export const ALL_CELLS = [...CELL_ORDER, '000'];

/**
 * @param devices  Map(canonicalId → device)，device.sources 为来源 id 集合
 * @param sourceIds 来源 id 顺序（决定模式的位序），如 ['A','B','C']
 * @returns { cells, counts7, observedUnion, recaptures, perSource }
 */
export function buildOverlap(devices, sourceIds) {
  const cells = new Map();
  for (const hist of CELL_ORDER) cells.set(hist, { hist, count: 0, devices: [] });
  const perSource = new Map(sourceIds.map((s) => [s, 0]));

  for (const dev of devices.values()) {
    const hist = sourceIds.map((s) => (dev.sources.has(s) ? '1' : '0')).join('');
    const cell = cells.get(hist);
    cell.count += 1;
    cell.devices.push(dev.id);
    for (const s of dev.sources) perSource.set(s, (perSource.get(s) ?? 0) + 1);
  }

  const counts7 = CELL_ORDER.map((h) => cells.get(h).count);
  // 重复捕获：出现在 ≥2 份名单的设备（111、110、101、011）
  const recaptures = counts7[0] + counts7[1] + counts7[2] + counts7[4];
  return { cells, counts7, observedUnion: devices.size, recaptures, perSource };
}
