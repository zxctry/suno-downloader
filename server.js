const http = require('http');
const https = require('https');
const tls = require('tls');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 7890;
const IS_LOCAL = !process.env.VERCEL && !process.env.NETLIFY;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

function httpsGet(url, callback) {
  if (!IS_LOCAL) {
    httpsGetDirect(url, callback);
  } else {
    httpsGetProxy(url, callback);
  }
}

function httpsGetDirect(url, callback) {
  var options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  };

  var req = https.get(url, options, function(res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      httpsGet(res.headers.location, callback);
      return;
    }
    var chunks = [];
    res.on('data', function(c) { chunks.push(c); });
    res.on('end', function() {
      var data = Buffer.concat(chunks).toString('utf8');
      callback(null, data, res.statusCode);
    });
  });
  req.on('error', callback);
  req.setTimeout(30000, function() { req.destroy(new Error('Timeout')); });
}

function httpsGetProxy(url, callback) {
  var urlObj = new URL(url);
  console.log('[INFO] Via proxy -> ' + urlObj.hostname);

  var connectReq = http.request({
    host: PROXY_HOST,
    port: PROXY_PORT,
    method: 'CONNECT',
    path: urlObj.hostname + ':443',
  });

  connectReq.on('connect', function(res, socket) {
    if (res.statusCode !== 200) {
      callback(new Error('Proxy CONNECT failed: ' + res.statusCode));
      return;
    }
    var tlsSocket = tls.connect({
      host: urlObj.hostname,
      socket: socket,
      servername: urlObj.hostname,
    }, function() {
      var reqStr = 'GET ' + urlObj.pathname + ' HTTP/1.1\r\n' +
        'Host: ' + urlObj.hostname + '\r\n' +
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n' +
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\r\n' +
        'Connection: close\r\n\r\n';
      tlsSocket.write(reqStr);
      var chunks = [];
      tlsSocket.on('data', function(c) { chunks.push(c); });
      tlsSocket.on('end', function() {
        var raw = Buffer.concat(chunks).toString('utf8');
        var headerEnd = raw.indexOf('\r\n\r\n');
        if (headerEnd === -1) { callback(new Error('Invalid response')); return; }
        var headerPart = raw.substring(0, headerEnd);
        var body = raw.substring(headerEnd + 4);
        var statusCode = parseInt(headerPart.split('\r\n')[0].split(' ')[1]);

        if (statusCode >= 300 && statusCode < 400) {
          var locMatch = headerPart.match(/Location:\s*(.+)/i);
          if (locMatch) {
            var redirectUrl = locMatch[1].trim();
            if (redirectUrl.startsWith('/')) redirectUrl = 'https://' + urlObj.hostname + redirectUrl;
            httpsGet(redirectUrl, callback);
            return;
          }
        }
        callback(null, body, statusCode);
      });
    });
    tlsSocket.on('error', callback);
  });
  connectReq.on('error', callback);
  connectReq.setTimeout(30000, function() { connectReq.destroy(new Error('Timeout')); });
  connectReq.end();
}

const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url.indexOf('/api/resolve/') === 0) {
    var shareCode = req.url.split('/api/resolve/')[1].split('?')[0];
    if (!shareCode) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Share code required' }));
      return;
    }
    console.log('[INFO] Resolving: ' + shareCode);
    httpsGet('https://suno.com/s/' + shareCode, function(err, data, status) {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      var match = data.match(/suno\.com\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (match) {
        var songId = match[1];
        var titleMatch = data.match(/<title>([^<]+?)\s*-\s*Suno/i);
        var title = titleMatch ? titleMatch[1].trim() : 'Suno Song';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ songId: songId, title: title, audioUrl: 'https://cdn1.suno.ai/' + songId + '.mp3' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Song not found' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url.indexOf('/api/song/') === 0) {
    var songId = req.url.split('/api/song/')[1].split('?')[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ songId: songId, audioUrl: 'https://cdn1.suno.ai/' + songId + '.mp3' }));
    return;
  }

  var filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  var ext = path.extname(filePath);
  fs.readFile(filePath, function(err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, function() {
  console.log('\n  Suno Downloader running at http://localhost:' + PORT);
  console.log('  Mode: ' + (IS_LOCAL ? 'Local (via proxy)' : 'Production (direct)') + '\n');
});
