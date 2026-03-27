const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const shareCode = req.query.code;
  if (!shareCode) {
    return res.status(400).json({ error: 'Share code required' });
  }

  try {
    const data = await httpsGet('https://suno.com/s/' + shareCode);
    const match = data.match(/suno\.com\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (match) {
      const songId = match[1];
      const titleMatch = data.match(/<title>([^<]+?)\s*-\s*Suno/i);
      const title = titleMatch ? titleMatch[1].trim() : 'Suno Song';
      return res.status(200).json({
        songId: songId,
        title: title,
        audioUrl: 'https://cdn1.suno.ai/' + songId + '.mp3'
      });
    } else {
      return res.status(404).json({ error: 'Song not found' });
    }
  } catch (err) {
    console.error('[resolve error]', err.message);
    return res.status(500).json({ error: err.message, detail: 'resolve_failed' });
  }
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    };
    const req = https.get(url, options, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () { req.destroy(new Error('Timeout')); });
  });
}
