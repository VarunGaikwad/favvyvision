const express = require("express");
const axios = require("axios");
const { parse } = require("tldts");

const app = express();
const PORT = process.env.PORT || 5173;

const faviconCache = new Map();
const CACHE_TTL = 1000 * 60 * 60;

async function fetchFavicon(url) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    return {
      data: response.data,
      size: response.data.length,
      contentType: response.headers["content-type"] || "image/x-icon",
    };
  } catch (err) {
    return null;
  }
}

app.get("/favicon", async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.status(400).send("Missing domain parameter");

  const now = Date.now();

  // Check cache
  if (faviconCache.has(domain)) {
    const cached = faviconCache.get(domain);
    if (now - cached.timestamp < CACHE_TTL) {
      res.set("Content-Type", cached.contentType);
      return res.send(cached.data);
    } else {
      faviconCache.delete(domain);
    }
  }

  const tryDomains = [domain];
  const parsed = parse(domain);
  if (parsed && parsed.domain && parsed.domain !== domain) {
    tryDomains.push(parsed.domain); // fallback to root domain
  }

  for (const d of tryDomains) {
    const googleUrl = `https://www.google.com/s2/favicons?domain=${d}&sz=256`;
    const duckUrl = `https://icons.duckduckgo.com/ip3/${d}.ico&s=256`;

    const [googleFavicon, duckFavicon] = await Promise.all([
      fetchFavicon(googleUrl),
      fetchFavicon(duckUrl),
    ]);

    const bestFavicon =
      (googleFavicon &&
        duckFavicon &&
        (googleFavicon.size >= duckFavicon.size
          ? googleFavicon
          : duckFavicon)) ||
      googleFavicon ||
      duckFavicon;

    if (bestFavicon) {
      faviconCache.set(domain, {
        data: bestFavicon.data,
        size: bestFavicon.size,
        contentType: bestFavicon.contentType,
        timestamp: now,
      });

      res.set("Content-Type", bestFavicon.contentType);
      return res.send(bestFavicon.data);
    }
  }

  return res.status(404).send("Favicon not found");
});

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Favicon API</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            text-align: center;
            color: #333;
          }
          h1 {
            color: #4A90E2;
          }
          code {
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <h1>🧩 Welcome to the Favicon API</h1>
        <p>This API allows you to fetch the favicon for any domain using a simple GET request.</p>
        <h3>Usage</h3>
        <p>
          <code>/favicon?domain=example.com</code>
        </p>
        <p>
          Returns the best-quality favicon from Google or DuckDuckGo sources.
        </p>
        <h3>Example</h3>
        <p>
          <a href="/favicon?domain=github.com">/favicon?domain=github.com</a>
        </p>
        <footer style="margin-top: 40px; font-size: 0.9em; color: #999;">
          🚀 Powered by Node.js + Express
        </footer>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Favvyvision proxy running at http://localhost:${PORT}`);
});
