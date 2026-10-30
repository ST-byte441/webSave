export function parseSrcset(srcset) {
  return srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor = ''] = part.split(/\s+/);
      return { url, descriptor };
    });
}

export function formatSrcset(candidates) {
  return candidates.map(({ url, descriptor }) => (descriptor ? `${url} ${descriptor}` : url)).join(', ');
}

export function largestCandidate(candidates) {
  let best = null;
  let bestSize = -1;
  for (const { url, descriptor } of candidates) {
    const size = parseFloat(descriptor) || 1;
    if (size > bestSize) {
      best = url;
      bestSize = size;
    }
  }
  return best;
}
