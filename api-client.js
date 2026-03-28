const EchtCheckAPI = (() => {
  const BASE = 'http://api.echt-check.de:3500';
  let available = null;

  async function ping() {
    if (available !== null) return available;
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) });
      available = r.ok;
    } catch { available = false; }
    return available;
  }

  async function analyzeImage(file) {
    if (!await ping()) return null;
    try {
      const fd = new FormData();
      fd.append('image', file, file.name);
      const r = await fetch(`${BASE}/analyze/image`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function checkDomain(url) {
    if (!await ping()) return null;
    try {
      const r = await fetch(`${BASE}/domain/check?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  return { ping, analyzeImage, checkDomain };
})();