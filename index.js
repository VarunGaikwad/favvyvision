const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const url_lib = require("url");
const fs = require("fs");

const app = express();

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36",
};

const default_response = (req, res) =>
  res
    .setHeader("content-type", "image/png")
    .status(404)
    .sendFile("/default.png", { root: __dirname });

const isValidURL = (str) => {
  try {
    new URL(str);
    return true;
  } catch (error) {
    return false;
  }
};

const checkTag = ($) => {
  let link =
    $('link[rel="icon"]').attr("href") ||
    $('link[rel="shortcut icon"]').attr("href") ||
    $('meta[property="og:image"]').attr("content") ||
    $('meta[itemprop="image"]').attr("content");

  if (link && link.startsWith("//")) {
    link = "https://" + link.slice(2);
  }

  return link || "";
};

const memory = {
  "https://mail.google.com": {
    type: "image/png",
    path: "./icons/aHR0cHM6Ly9tYWlsLmdvb2dsZS5jb20=",
  },
  "https://chatgpt.com": {
    type: "image/png",
    path: "./icons/aHR0cHM6Ly9jaGF0Z3B0LmNvbQ==",
  },
};

const icon_from_memory = (origin, res) => {
  const { type, path } = memory[origin];
  res.setHeader("content-type", header["content-type"]);
  return res.setHeader("content-type", type).status(200).sendFile(path, {
    root: ".",
  });
};

app.get("/favicon", async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send("Parameter missing");

  try {
    const { origin } = new URL(url);

    if (memory[origin]) return icon_from_memory(origin, res);

    const { data: html } = await axios(origin, {
      headers,
    });

    const $ = cheerio.load(html);

    const _favicon_url = checkTag($);

    if (!_favicon_url) return default_response(req, res);

    const favicon_url = isValidURL(_favicon_url)
      ? _favicon_url
      : url_lib.resolve(origin, _favicon_url);

    const { data, headers: header } = await axios.get(favicon_url, {
      headers,
      responseType: "arraybuffer",
    });

    res.setHeader("content-type", header["content-type"]);
    fs.writeFile(`./icons/${btoa(origin)}`, data, (err) => {
      if (err) {
        return "";
      }

      memory[origin] = {
        type: header["content-type"],
        path: `./icons/${btoa(origin)}`,
      };
    });

    return res.send(data).status(200);
  } catch (error) {
    return default_response(req, res);
  }
});

app.get("/", (req, res) =>
  res.status(200).send("Welcome Favvy Vision 😁 😀 😊")
);

const port = 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
