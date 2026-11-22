// Short links for shared keepsakes. The note itself is already packed into a
// compact string by js/share.js; this just keeps it under a short id so the
// link someone receives is tidy.
//   POST /api/notes  { k }  ->  { id }
//   GET  /api/notes?id=..   ->  { k }
// Storage is the Upstash Redis store attached to the project in Vercel
// (Storage tab), reached over its REST API, so there are no dependencies.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const MAX_LEN = 60000;
const PER_HOUR = 60; // notes one visitor can save in an hour
const ID_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function redis(...commands) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`storage ${r.status}`);
  return (await r.json()).map((x) => x.result);
}

function newId(n = 7) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

module.exports = async (req, res) => {
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'storage not set up' });
  try {
    if (req.method === 'GET') {
      const id = String(req.query.id || '');
      if (!/^[A-Za-z0-9]{4,16}$/.test(id)) return res.status(400).json({ error: 'bad id' });
      const [k] = await redis(['GET', `note:${id}`]);
      if (!k) return res.status(404).json({ error: 'not found' });
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).json({ k });
    }

    if (req.method === 'POST') {
      const k = req.body && req.body.k;
      if (typeof k !== 'string' || !k.length || k.length > MAX_LEN || !/^[\w-]+$/.test(k)) {
        return res.status(400).json({ error: 'bad note' });
      }
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const [count] = await redis(['INCR', `rate:${ip}`], ['EXPIRE', `rate:${ip}`, 3600, 'NX']);
      if (count > PER_HOUR) return res.status(429).json({ error: 'slow down' });
      for (let tries = 0; tries < 5; tries++) {
        const id = newId();
        const [ok] = await redis(['SET', `note:${id}`, k, 'NX']);
        if (ok === 'OK') return res.status(200).json({ id });
      }
      return res.status(500).json({ error: 'no id' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'storage error' });
  }
};
