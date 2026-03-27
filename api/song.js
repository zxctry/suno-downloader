module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const songId = req.query.id;
  if (!songId) {
    return res.status(400).json({ error: 'Song ID required' });
  }

  return res.status(200).json({
    songId: songId,
    audioUrl: 'https://cdn1.suno.ai/' + songId + '.mp3'
  });
};
