const { url } = require("inspector");

const express = require("express"),
  axios = require("axios"),
  fs = require("fs"),
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
  default_response = (req, res) =>
    res
      .setHeader("content-type", "image/png")
      .status(404)
      .sendFile("/default.png", { root: __dirname }),
  validate_url = (str) => {
    try {
      new URL(str);
      return true;
    } catch (error) {
      return false;
    }
  },
  memory = {
    "https://chatgpt.com": {
      url: "https://cdn.oaistatic.com/_next/static/media/apple-touch-icon.82af6fe1.png",
    },
    "https://mail.google.com": {
      url: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico",
    },
    "https://development-oc58dg9d.us10cf.applicationstudio.cloud.sap": {
      url: "https://development-oc58dg9d.us10cf.applicationstudio.cloud.sap/resources/images/ApplicationStudio_logo.png",
    },
    "https://www.soldev.app": { url: "https://www.soldev.app/logo-light.svg" },
    "https://www.google.com/": {
      url: "https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png",
    },
    "https://www.duolingo.com/": {
      url: "https://d35aaqx5ub95lt.cloudfront.net/favicon.ico",
    },
  };

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "main.html")));

app.get("/favicon", async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send("Parameter missing");

  try {
    const { origin } = correct_url(url);

    if (memory[origin]) {
      const { url, icon_path, icon_type } = memory[origin];

      if (icon_path) {
        const filePath = path.join(__dirname, icon_path);
        res.setHeader("content-type", icon_type);
        return res.sendFile(filePath, (err) => {
          if (err) {
            res.status(err.status).end();
          }
        });
      }

      const { data, headers: header } = await axios.get(memory[origin].url, {
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

    if (!_favicon_url) throw Error("FavIcon missing!");

    memory[origin] = { url: favicon_url };

    const { data, headers: header } = await axios.get(favicon_url, {
      headers,
      responseType: "arraybuffer",
    });

    fs.writeFile(`./icons/${btoa(origin)}`, data, (err) => {
      if (err) return;
      memory[origin].icon_path = `/icons/${btoa(origin)}`;
      memory[origin].icon_type = header["content-type"];
    });
    res.setHeader("content-type", header["content-type"]);
    return res.send(data).status(200);
  } catch (error) {
    return res.send(error.message).status(400);
  }
});

app.listen(port);
