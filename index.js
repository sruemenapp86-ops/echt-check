const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

const db = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'echtcheck',
  user: process.env.DB_USER || 'echtcheck',
  password: process.env.DB_PASS || 'ec_secret_2024',
});

const MODEL_URL = process.env.MODEL_URL || 'http://model:8000';

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', gpu: true, db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/analyze/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Kein Bild uebermittelt' });

    const imageBuffer = req.file.buffer;
    const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');

    // Cache pruefen
    const existing = await db.query('SELECT * FROM image_hashes WHERE phash = $1', [hash]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return res.json({ source: 'cache', hash, ...row });
    }

    // KI-Modell anfragen
    let aiResult = { score: 50, verdict: 'uncertain', confidence: 0, method: 'statistical_fallback' };
    try {
      const modelRes = await axios.post(`${MODEL_URL}/predict`, imageBuffer, {
        headers: { 'Content-Type': req.file.mimetype },
        timeout: 90000
      });
      if (modelRes.data && modelRes.data.verdict) {
        aiResult = modelRes.data;
      }
    } catch (modelErr) {
      console.warn('Modell Fallback:', modelErr.message);
    }

    // In DB speichern (inkl. score + method)
    await db.query(
      'INSERT INTO image_hashes (phash, verdict, confidence, score, method, source) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (phash) DO NOTHING',
      [hash, aiResult.verdict, aiResult.confidence || 0, aiResult.score || 50, aiResult.method || 'statistical_fallback', 'api']
    );

    res.json({ source: 'fresh', hash, ...aiResult });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/domain/check', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url Parameter fehlt' });
  try {
    let domain;
    try { domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', ''); }
    catch { domain = url.replace('www.', ''); }
    const result = await db.query('SELECT * FROM known_domains WHERE domain = $1', [domain]);
    if (result.rows.length > 0) return res.json({ domain, found: true, ...result.rows[0] });
    res.json({ domain, found: false, reputation: 'unknown' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/domain/add', async (req, res) => {
  const { domain, reputation, category, source } = req.body;
  if (!domain || !reputation) return res.status(400).json({ error: 'domain und reputation erforderlich' });
  try {
    await db.query(
      'INSERT INTO known_domains (domain, reputation, category, source) VALUES ($1, $2, $3, $4) ON CONFLICT (domain) DO UPDATE SET reputation=$2, updated_at=NOW()',
      [domain, reputation, category || null, source || 'manual']
    );
    res.json({ success: true, domain });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const domains = await db.query('SELECT COUNT(*) FROM known_domains');
    const hashes = await db.query('SELECT COUNT(*) FROM image_hashes');
    res.json({ known_domains: parseInt(domains.rows[0].count), analyzed_images: parseInt(hashes.rows[0].count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── URL-Abruf & Textextraktion ────────────────────────────────────────────
function fetchAndExtract(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 4) return reject(new Error('Zu viele Weiterleitungen'));
    const lib = targetUrl.startsWith('https') ? require('https') : require('http');
    const req = lib.get(targetUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity'
      }
    }, (response) => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        const next = response.headers.location.startsWith('http')
          ? response.headers.location
          : new URL(response.headers.location, targetUrl).href;
        req.destroy();
        return fetchAndExtract(next, redirectCount + 1).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size < 2097152) chunks.push(chunk); });
      response.on('end', () => { try { resolve(extractContent(Buffer.concat(chunks).toString('utf8'))); } catch(e) { reject(e); } });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractContent(html) {
  const titleM = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : '';
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i)
             || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,500})["']/i);
  const description = descM ? descM[1].trim() : '';
  const imgM = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const imageUrl = imgM ? imgM[1].trim() : null;

  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '').replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const articleM = cleaned.match(/<article[^>]*>([\s\S]+?)<\/article>/i)
                || cleaned.match(/<main[^>]*>([\s\S]+?)<\/main>/i);
  const source = articleM ? articleM[1] : cleaned;

  const text = source
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n').replace(/ {2,}/g, ' ').trim().slice(0, 8000);

  return { title, description, imageUrl, text };
}

// ─── POST /analyze/url ─────────────────────────────────────────────────────
app.post('/analyze/url', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL fehlt' });
  let parsed;
  try { parsed = new URL(url.trim()); } catch { return res.status(400).json({ error: 'Ungültige URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Nur HTTP/HTTPS erlaubt' });
  const hostname = parsed.hostname;
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(hostname))
    return res.status(400).json({ error: 'Private Adressen nicht erlaubt' });

  const domain = hostname.replace(/^www\./, '');
  let domainInfo = { found: false, reputation: 'unknown', domain };
  try {
    const dr = await db.query('SELECT * FROM known_domains WHERE domain = $1', [domain]);
    if (dr.rows.length > 0) domainInfo = { found: true, ...dr.rows[0] };
  } catch(e) {}

  let content;
  try { content = await fetchAndExtract(parsed.href); }
  catch(e) { return res.status(502).json({ error: `Seite nicht erreichbar: ${e.message}`, domain, domainInfo, url: parsed.href }); }

  res.json({ url: parsed.href, domain, domainInfo, ...content, textLength: content.text.length });
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => console.log(`Echt-Check API laeuft auf Port ${PORT}`));