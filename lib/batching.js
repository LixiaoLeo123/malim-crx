/**
 * Sentence batching algorithms.
 * Direct port from src-tauri/src/lib.rs lines 375-505
 */

/**
 * Count the number of "units" (words + punctuation tokens) in a sentence.
 * Ported from lib.rs count_sentence_units()
 */
export function countSentenceUnits(text) {
  let count = 0;
  let inWord = false;
  let inPunct = false;

  for (const ch of text) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      inWord = false;
      inPunct = false;
      continue;
    }

    if (/[a-zA-Zа-яА-ЯёЁ0-9]/.test(ch) || ch === '\'' || ch === '’' || ch === '-') {
      if (!inWord) {
        count++;
        inWord = true;
        inPunct = false;
      }
    } else {
      if (!inPunct) {
        count++;
        inPunct = true;
        inWord = false;
      }
    }
  }

  return count;
}

/**
 * Best-Fit Decreasing bin packing.
 * Ported from lib.rs bfd_grouping()
 */
export function bfdGrouping(items, capacity) {
  if (items.length === 0) return [];

  if (capacity === 0) {
    return items.map(([index]) => [index]);
  }

  // Sort by weight descending, then by index
  const sorted = items.map(([index, weight]) => ({ index, weight }));
  sorted.sort((a, b) => b.weight - a.weight || a.index - b.index);

  /** @type {{ weight: number, indices: number[] }[]} */
  const bins = [];

  for (const { index, weight } of sorted) {
    if (weight > capacity) {
      bins.push({ weight, indices: [index] });
      continue;
    }

    let bestBinIndex = -1;
    let bestSpaceLeft = Infinity;

    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      const spaceLeft = capacity - (bin.weight + weight);
      if (spaceLeft >= 0 && spaceLeft < bestSpaceLeft) {
        bestSpaceLeft = spaceLeft;
        bestBinIndex = i;
      }
    }

    if (bestBinIndex >= 0) {
      bins[bestBinIndex].weight += weight;
      bins[bestBinIndex].indices.push(index);
    } else {
      bins.push({ weight, indices: [index] });
    }
  }

  // Sort each group by original index
  return bins.map(bin => bin.indices.sort((a, b) => a - b));
}

/**
 * Split items into at most K groups with balanced weight.
 * Ported from lib.rs split_into_k_groups()
 */
export function splitIntoKGroups(items, k) {
  if (items.length === 0 || k === 0) return [];

  const groupCount = Math.min(k, items.length);
  const weights = items.map(([, weight]) => weight);
  let left = Math.max(...weights);
  let right = weights.reduce((a, b) => a + b, 0);

  const canSplit = (limit) => bfdGrouping(items, limit).length <= groupCount;

  while (left < right) {
    const mid = left + Math.floor((right - left) / 2);
    if (canSplit(mid)) {
      right = mid;
    } else {
      left = mid + 1;
    }
  }

  const limit = left;
  const weightMap = new Map(items);
  let groups = bfdGrouping(items, limit);

  while (groups.length < groupCount) {
    // Find heaviest group
    let heaviestIdx = 0;
    let heaviestWeight = 0;
    for (let i = 0; i < groups.length; i++) {
      const w = groups[i].reduce((sum, idx) => sum + weightMap.get(idx), 0);
      if (w > heaviestWeight) {
        heaviestWeight = w;
        heaviestIdx = i;
      }
    }

    if (groups[heaviestIdx].length <= 1) break;

    // Find heaviest item in the heaviest group
    let heaviestItemPos = 0;
    let heaviestItemWeight = 0;
    for (let j = 0; j < groups[heaviestIdx].length; j++) {
      const w = weightMap.get(groups[heaviestIdx][j]);
      if (w > heaviestItemWeight) {
        heaviestItemWeight = w;
        heaviestItemPos = j;
      }
    }

    const splitItem = groups[heaviestIdx].splice(heaviestItemPos, 1)[0];
    groups.push([splitItem]);
  }

  return groups;
}
