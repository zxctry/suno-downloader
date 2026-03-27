const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const data = await httpsGet(url);

    // Extract song ID
    const songMatch = data.match(/suno\.com\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (!songMatch) {
      return res.status(404).json({ error: 'Song not found. The link may be invalid or the song is private.' });
    }

    const songId = songMatch[1];

    // Extract title
    const titleMatch = data.match(/<title>([^<]+?)\s*-\s*Suno/i);
    let title = titleMatch ? titleMatch[1].trim() : 'Suno Song';

    // Extract metadata from JSON-LD or meta tags
    let author = '';
    let style = '';
    let thumbnail = '';
    let duration = '';

    // Try og:image for thumbnail
    const imgMatch = data.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (imgMatch) thumbnail = imgMatch[1];

    // Try og:title for more info
    const ogTitleMatch = data.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitleMatch && !titleMatch) {
      const clean = ogTitleMatch[1].replace(/\s*-\s*Suno\s*$/i, '').trim();
      if (clean) title = clean;
    }

    // Try to extract from JSON data in page
    const jsonMatch = data.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonMatch) {
      try {
        const jsonData = JSON.parse(jsonMatch[1]);
        const pageData = jsonData?.props?.pageProps;
        if (pageData) {
          // Try various possible data structures
          if (pageData.clip) {
            const clip = pageData.clip;
            if (clip.metadata) {
              author = clip.metadata.prompt || '';
              style = clip.metadata.tags || clip.metadata.style || '';
              duration = clip.metadata.duration ? formatDuration(clip.metadata.duration) : '';
            }
            if (clip.image_url) thumbnail = clip.image_url;
            if (clip.title) title = clip.title;
            if (clip.audio_url) {
              return res.status(200).json({
                title: title,
                author: author,
                duration: duration,
                style: style,
                thumbnail: thumbnail,
                audio: clip.audio_url,
                video: clip.video_url || null,
              });
            }
          }
        }
      } catch (e) {
        // JSON parse failed, continue with defaults
      }
    }

    // Fallback: construct CDN URLs
    const audioUrl = 'https://cdn1.suno.ai/' + songId + '.mp3';
    const videoUrl = 'https://cdn1.suno.ai/' + songId + '.mp4';

    return res.status(200).json({
      title: title,
      author: author,
      duration: duration,
      style: style,
      thumbnail: thumbnail,
      audio: audioUrl,
      video: videoUrl,
    });
  } catch (err) {
    console.error('[sniff error]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function httpsGet(inputUrl, maxRedirects) {
  maxRedirects = maxRedirects || 5;
  return new Promise(function (resolve, reject) {
    var parsedUrl = new URL(inputUrl);
    var options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      }
    };
    var req = https.request(options, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        var redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = 'https://' + parsedUrl.hostname + redirectUrl;
        }
        if (maxRedirects > 0) {
          httpsGet(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
        } else {
          reject(new Error('Too many redirects'));
        }
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, function () { req.destroy(new Error('Request timeout')); });
    req.end();
  });
}
