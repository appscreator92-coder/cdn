// api/proxy.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, referer } = req.query;
  if (!url) return res.status(400).send('Missing url parameter');

  try {
    const targetUrl = decodeURIComponent(url);
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      return res.status(400).send('Invalid URL');
    }

    const targetReferer = referer ? decodeURIComponent(referer) : 'https://cdnlivetv.tv/';
    const targetHost = new URL(targetUrl).host;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': targetReferer,
        'Origin': new URL(targetReferer).origin,
        'Host': targetHost,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site'
      }
    });

    if (!response.ok) {
      return res.status(response.status).send(`Upstream returned status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'application/vnd.apple.mpegurl';
    res.setHeader('Content-Type', contentType);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || buffer.toString('utf-8', 0, 7) === '#EXTM3U') {
      const bodyText = buffer.toString('utf-8');
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const proxyPath = `${protocol}://${host}/api/proxy.js`;

      const rewrittenLines = bodyText.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          let absoluteChunkUrl = trimmed;
          if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            absoluteChunkUrl = trimmed.startsWith('/') ? new URL(targetUrl).origin + trimmed : baseUrl + trimmed;
          }
          return `${proxyPath}?url=${encodeURIComponent(absoluteChunkUrl)}&referer=${encodeURIComponent(targetReferer)}`;
        }
        return line;
      });

      return res.status(200).send(rewrittenLines.join('\n'));
    }

    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).send('Proxy Error: ' + error.message);
  }
}
