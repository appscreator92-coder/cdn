const M3U_URL = 'https://raw.githubusercontent.com/appscreator92-coder/spor/refs/heads/main/SPORTS.m3u';

module.exports = async (req, res) => {
    // 1. ALWAYS set CORS headers immediately at response start
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { channel, url, referer } = req.query;

    try {
        // --- A. Channel Request Handler ---
        if (channel) {
            const m3uResponse = await fetch(M3U_URL);
            if (!m3uResponse.ok) {
                return res.status(502).send('Error: Could not fetch M3U playlist from GitHub.');
            }
            const m3uText = await m3uResponse.text();
            const lines = m3uText.split(/\r\n|\n|\r/);
            
            let streamUrl = '';
            let streamReferer = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXTINF:')) {
                    const parts = line.split(',');
                    const namePart = parts[parts.length - 1].trim();

                    if (namePart.toLowerCase() === channel.toLowerCase()) {
                        for (let j = i + 1; j < i + 5; j++) {
                            if (!lines[j]) continue;
                            const nextLine = lines[j].trim();
                            if (nextLine.startsWith('#EXTVLCOPT:http-referrer=')) {
                                streamReferer = nextLine.replace('#EXTVLCOPT:http-referrer=', '');
                            } else if (nextLine.startsWith('http://') || nextLine.startsWith('https://')) {
                                streamUrl = nextLine;
                                break;
                            }
                        }
                        if (streamUrl) break;
                    }
                }
            }

            if (!streamUrl) {
                return res.status(404).send(`Error: Channel "${channel}" not found.`);
            }

            const host = req.headers.host;
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const proxyRedirectUrl = new URL(`${protocol}://${host}${req.url.split('?')[0]}`);
            
            proxyRedirectUrl.searchParams.set('url', streamUrl);
            if (streamReferer) {
                proxyRedirectUrl.searchParams.set('referer', streamReferer);
            }

            return res.redirect(302, proxyRedirectUrl.toString());
        }

        // --- B. Direct Proxy Handler ---
        if (url) {
            const targetUrl = decodeURIComponent(url);
            const targetReferer = referer ? decodeURIComponent(referer) : 'https://cdnlivetv.tv/';
            
            let targetOrigin = 'https://cdnlivetv.tv';
            try {
                targetOrigin = new URL(targetReferer).origin;
            } catch (e) {}

            // Pass headers to pass through anti-hotlinking checks
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': targetReferer,
                'Origin': targetOrigin,
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site'
            };

            const targetResponse = await fetch(targetUrl, { headers });

            if (!targetResponse.ok) {
                return res.status(targetResponse.status).send(`Upstream stream returned status ${targetResponse.status}`);
            }

            // Copy content headers safely
            targetResponse.headers.forEach((value, name) => {
                const lowerName = name.toLowerCase();
                if (!['content-encoding', 'transfer-encoding', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(lowerName)) {
                    res.setHeader(name, value);
                }
            });

            const contentType = targetResponse.headers.get('content-type') || '';
            const isM3U8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('m3u');

            // Handle M3U8 Playlist rewriting
            if (isM3U8) {
                const body = await targetResponse.text();
                const host = req.headers.host;
                const protocol = req.headers['x-forwarded-proto'] || 'https';
                const requestUrl = `${protocol}://${host}${req.url.split('?')[0]}`;
                
                const rewrittenBody = rewritePlaylist(body, targetUrl, targetReferer, requestUrl);
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                return res.status(200).send(rewrittenBody);
            }

            // Buffer streaming for video chunks (.ts)
            const arrayBuffer = await targetResponse.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            return res.status(200).send(buffer);
        }

        // --- C. Root Welcome Route ---
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send('Vercel M3U Proxy active!\n\nUse /api/proxy?channel=CHANNEL_NAME or /api/proxy?url=STREAM_URL');

    } catch (error) {
        console.error('Serverless Proxy Error:', error);
        return res.status(500).send('Proxy Server Error: ' + error.message);
    }
};

function rewritePlaylist(body, playlistUrl, referer, requestUrl) {
    const playlistBaseUrl = new URL(playlistUrl);

    return body.trim().split(/\r\n|\n|\r/).map(line => {
        line = line.trim();
        if (!line) return '';

        if (!line.startsWith('#')) {
            const absoluteUrl = new URL(line, playlistBaseUrl).href;
            const proxyUrl = new URL(requestUrl);
            proxyUrl.searchParams.set('url', absoluteUrl);
            if (referer) {
                proxyUrl.searchParams.set('referer', referer);
            }
            return proxyUrl.toString();
        }
        
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch && uriMatch[1]) {
            const absoluteUri = new URL(uriMatch[1], playlistBaseUrl).href;
            const proxyUrl = new URL(requestUrl);
            proxyUrl.searchParams.set('url', absoluteUri);
            if (referer) {
                proxyUrl.searchParams.set('referer', referer);
            }
            return line.replace(uriMatch[1], proxyUrl.toString());
        }

        return line;
    }).join('\n');
}
