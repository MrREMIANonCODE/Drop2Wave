const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');

function setCacheHeaders(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const longCacheExt = new Set(['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2']);

  if (longCacheExt.has(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return;
  }

  if (ext === '.html' || ext === '.json') {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

// Serve static files under /public and resolve extensionless .html pages.
app.use('/public', express.static(publicDir, { extensions: ['html'], setHeaders: setCacheHeaders }));

// Also allow root-level serving for convenience.
app.use(express.static(publicDir, { extensions: ['html'], setHeaders: setCacheHeaders }));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Drop2Wave running at http://127.0.0.1:${PORT}`);
});
