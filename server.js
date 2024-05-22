const express = require("express"),
  axios = require("axios"),
  cheerio = require("cheerio"),
  url_lib = require("url"),
  path = require("path"),
  app = express(),
  headers = {
    "User-Agent": "FavvyVision/1.0.0",
  },
  port = 3000,
  correct_url = (url) => {
    const prefix = "https://";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const { origin } = new URL(url);
      return { origin };
    }
    const { origin } = new URL(`${prefix}${url}`);
    return { origin };
  },
  check_tag = ($) => {
    let link =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      $('meta[property="og:image"]').attr("content") ||
      $('meta[itemprop="image"]').attr("content");

    if (link && link.startsWith("//")) {
      link = "https://" + link.slice(2);
    }

    return link || "";
  },
  validate_url = (str) => {
    try {
      new URL(str);
      return true;
    } catch (error) {
      return false;
    }
  },
  memory = {};

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "main.html")));

app.get("/favicon", async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send("Parameter missing");

  try {
    const { origin } = correct_url(url);

    if (memory[origin]) {
      const { data, headers: header } = await axios.get(memory[origin], {
        headers,
        responseType: "arraybuffer",
      });
      res.setHeader("content-type", header["content-type"]);
      return res.send(data).status(200);
    }

    const { data: html } = await axios.get(origin, {
        headers,
      }),
      $ = cheerio.load(html),
      _favicon_url = check_tag($),
      favicon_url = validate_url(_favicon_url)
        ? _favicon_url
        : url_lib.resolve(origin, _favicon_url);

    memory[origin] = favicon_url;

    const { data, headers: header } = await axios.get(favicon_url, {
      headers,
      responseType: "arraybuffer",
    });

    res.setHeader("content-type", header["content-type"]);
    return res.send(data).status(200);
  } catch (error) {
    return res.send(error.message).status(400);
  }
});

app.listen(port);
