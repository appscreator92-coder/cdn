import json
import re
import requests
import base64
from urllib.parse import unquote

class StreamExtractor:
    def __init__(self, referer):
        self.referer = referer
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": self.referer,
            "Origin": self.referer.rstrip('/')
        })

    def _convert_base(self, d, e, f):
        """Custom base conversion for deobfuscation logic."""
        g = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/"
        h_chars = g[:e]
        i_chars = g[:f]
        
        j = 0
        for c_idx, c_val in enumerate(d[::-1]):
            if c_val in h_chars:
                j += h_chars.index(c_val) * (e**c_idx)

        if j == 0: return '0'
        
        k = ''
        while j > 0:
            k = i_chars[j % f] + k
            j //= f
        return k

    def deobfuscate(self, h, n, t, e):
        """Decodes the 'packed' JavaScript strings."""
        r = ""
        delimiter = n[e]
        n_map = {char: str(idx) for idx, char in enumerate(n)}
        
        parts = h.split(delimiter)
        for s in parts:
            if s:
                s_digits = "".join([n_map.get(c, c) for c in s])
                char_code = int(self._convert_base(s_digits, e, 10)) - t
                r += chr(char_code)
        return r

    def decode_b64(self, s):
        """Standardizes and decodes modified Base64."""
        s = s.replace('-', '+').replace('_', '/')
        s += '=' * (-len(s) % 4)
        return base64.b64decode(s).decode('utf-8')

    def get_m3u8(self, channel_url):
        try:
            resp = self.session.get(channel_url, timeout=10)
            resp.raise_for_status()
            
            # More robust regex for the eval pattern
            pattern = r"eval\(function\(h,u,n,t,e,r\)\{.*?\}\((.*?)\)\)"
            match = re.search(pattern, resp.text, re.DOTALL)
            if not match: return None

            # Improved param extraction
            params = re.findall(r"'(.*?)'|\d+", match.group(1))
            h, n = params[0], params[1]
            t, e = int(params[2]), int(params[3])

            code = self.deobfuscate(h, n, t, e)
            
            # Extract variables and decode stream parts
            consts = dict(re.findall(r"const\s+(\w+)\s+=\s+'([^']+)';", code))
            parts_match = re.search(r"src:\s*.*?\((.*?)\)", code)
            
            if parts_match:
                var_names = re.findall(r"(\w+)", parts_match.group(1))
                url = "".join([self.decode_b64(consts[v]) for v in var_names if v in consts])
                return url
        except Exception as e:
            print(f"Error extracting {channel_url}: {e}")
        return None

# --- Execution ---
REFERER = "https://edge.cdn-live.ru/"
extractor = StreamExtractor(REFERER)

# Example API call to get channels
try:
    api_url = "https://api.cdn-live.tv/api/v1/channels/?user=cdnlivetv&plan=free"
    channels = requests.get(api_url, headers={"Referer": REFERER}).json().get('channels', [])
    
    with open("playlist_2026.m3u", "w", encoding='utf-8') as f:
        f.write('#EXTM3U\n')
        for ch in channels:
            if ch.get('status') == 'online':
                print(f"Extracting: {ch['name']}")
                stream = extractor.get_m3u8(ch['url'])
                if stream:
                    f.write(f'#EXTINF:-1 tvg-logo="{ch.get("image")}",{ch["name"]}\n')
                    f.write(f'#EXTVLCOPT:http-referrer={REFERER}\n')
                    f.write(f"{stream}\n")
    print("Updated playlist created.")
except Exception as e:
    print(f"API Error: {e}")
