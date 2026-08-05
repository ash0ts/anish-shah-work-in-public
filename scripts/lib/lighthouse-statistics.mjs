export function selectMedianLighthouseResult(results) {
  if (!Array.isArray(results) || results.length === 0 || results.length % 2 === 0) {
    throw new Error("Lighthouse median selection requires an odd, non-empty sample set.");
  }

  const ranked = results.map((result, index) => {
    const score = result?.lhr?.categories?.performance?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new Error(`Lighthouse sample ${index + 1} has no finite performance score.`);
    }
    return { index, result, score };
  });

  ranked.sort((left, right) => left.score - right.score || left.index - right.index);
  return ranked[Math.floor(ranked.length / 2)].result;
}
