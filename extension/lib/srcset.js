// Follows the HTML srcset rules closely enough for real pages: a URL is a run
// of non-whitespace (so CDN transforms like w_400,h_300 keep their commas),
// and a comma after the descriptor ends the candidate.
export function parseSrcset(srcset) {
  const candidates = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
    if (i >= srcset.length) break;
    let start = i;
    while (i < srcset.length && !/\s/.test(srcset[i])) i++;
    let url = srcset.slice(start, i);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      start = i;
      while (i < srcset.length && srcset[i] !== ',') i++;
      descriptor = srcset.slice(start, i).trim();
    }
    candidates.push({ url, descriptor });
  }
  return candidates;
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
