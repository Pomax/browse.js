/**
 * # Browse dot JS
 *
 * A super-simple but super-useful image browsing script.
 * Run as `node browse` in whatever toplevel dir houses all
 * your images, and then just fire up http:/localhost:8080
 *
 * It will treat its own folder as root, and allow you to
 * browse any subfolder as either a dir listing (if there are
 * no images in it) or gallery (if there are).
 *
 * Or, if you need a custom port use `node browse --port 12345`
 * with the obvious port number replacement.
 *
 * ## Requirements
 *
 *  - Node 22 or newer
 *  - 7z CLI utility
 *
 * ## Code notes
 *
 * This code is organized in blocks that any IDE should be able
 * to collapse/expand as needed to keep it easy to work on. But,
 * if your editor has no collapse/expand, there's also heading
 * comments to find your way around the code.
 *
 * ## How to browse
 *
 * Basic avigation is pretty self-explanatory, and clicking an
 * image in an image gallery will swith to a "fullscreen" mode.
 *
 * ### Gallery mode controls
 *
 *   - click an image = load that image
 *   - home/end = load first/last image
 *   - left/right = load prev/next image
 *   - pgup/pgdn = same
 *   - up/esc or the "up" link = go up a dir
 *   - the "delete" button = delete this entire folder
 *
 * ### Full screen mode controls:
 *
 *   - up/esc = exit full screen
 *   - home/end = load first/last image
 *   - left/right = load prev/next image
 *   - pgup/pgdn = same
 *
 * ### Active regions in full screen
 *
 *   - top 25% of the image = exit full screen
 *   - bottom 75% of the image:
 *     - left half = load previous image
 *     - right half = load next image
 *
 * ### Dir listings
 *
 * While on a dir listing you can drag-and-drop a zip file
 * onto the dir and it will simply unpack the zip file as
 * its own subdir in that dir. Handy!
 *
 * ## Notes
 *
 * The URL will update based on what you're doing, and you
 * can always reload/copy-paste the link to get the same
 * view you were looking at for that URL. That should be
 * obvious, but not every web based tool bothers with that.
 *
 * ## Contact
 *
 * Either hit up the issue tracker over on the issue tracker
 * https://github.com/Pomax/browse.js/issues, or toot at
 * me on https://mastodon.social/users/@TheRealPomax
 */

import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { dirname, normalize } from "node:path";
import {
  createWriteStream,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  stat,
  statSync,
  unlinkSync,
} from "node:fs";

/*****************************************************************
 *                                                               *
 *                          CONSTANTS                            *
 *                                                               *
 *****************************************************************/

// SET THIS TO WHATEVER WORKS FOR YOU:
const concurrency = 5;

// The rest of these shouldn't really need modifying
const imageCacheDuration = 604800;
const contentType = `Content-Type`;
const cacheControl = `Cache-Control`;
const base = normalize(import.meta.dirname);
const formats = [`jpg`, `jpeg`, `png`, `webp`];
const unwantedDataPaths = [`@eaDir`, `.DS_Store`, `Thumbs.db`];
const portIndex = process.argv.indexOf(`--port`);
const port = portIndex >= 0 ? process.argv[portIndex + 1] : 8080;

/*****************************************************************
 *                                                               *
 *                      TEMPLATING: CSS                          *
 *                                                               *
 *****************************************************************/

const CSS = {
  page: `html {
  font-size: 2vh!important;

  a, a:active, a:hover, a:visited {
    color: blue;
  }
`,

  dirlisting: `html {
  ol.dirlist {
    &.with-covers {
     list-style: none;
      display: flex;
      flex-wrap: wrap;
      li {
        display: block;
        overflow: hidden;
        width: 22vw;
        margin: 0.5em;
        img {
          vertical-align: middle;
          display: block;
          height: 200px;
          margin: auto;
          margin-bottom: 1em;
        }
      }
    }
  }
}
`,

  gallery: `html {
  h1 {
    display: inline-block;
    font-size: 2rem !important;
    margin: 0;
    padding-left: 2rem;
    text-transform: capitalize;
  }

  &:has(.gallery img.full) {
    cursor: pointer;
    h1 { display: none; }
    span { display: none; }
    .delete { display: none; }
  }

  .delete {
    position: absolute;
    top: 1.5vh;
    right: 1.5vw;
  }

  .gallery {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    user-select: none;
    background-color: #999;

    &:has(.full) {
      img:not(.full) {
        display: none;
      }
    }

    img {
      cursor: pointer;

      .loading {
        opacity: 0;
      }

      &.full {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        width: auto;
        max-width: 100%;
        height: 100%;
        max-height: 100%;
        margin: auto;
        object-fit: contain;
      }

      &:not(.full) {
        max-width: 200px;
        max-height: 300px;
        object-fit: contain;
        background: #eee6;
        border: 1px solid white;
        margin: 0.25em;
      }
    }
  }
}
`,
};

/*****************************************************************
 *                                                               *
 *                      TEMPLATING: CODE                         *
 *                                                               *
 *****************************************************************/

const Template = {
  // our main document scaffolding
  create: function (path, content) {
    return `<html lang="en" translate="no">
  <head>
    <meta charset="utf-8">
    <title>${path.match(/[^\/]+\/?$/)?.[0]?.replaceAll(`/`, ``)}</title>
    ${Template.style(CSS.page)}
    <script>globalThis.path = "${encodeURIComponent(path)}";</script>
  </head>
  <body>
    ${Template.script(ClientSide.goUp.toString())}
    ${content}
  </body>
</html>
  `;
  },

  // generate an image with a lazy-load data attribute instead of src attribute
  img: function (src, position) {
    return `<img id="img-${position}" width="200" height="300" title="${src}" data-src="./${encodeURIComponent(src)}">`;
  },

  // generate a link
  a: function (href, label = href, img = ``) {
    return `<a href="${href}">${img}${label}</a>`;
  },

  // generate a <div> element
  div: function (content, className = ``) {
    return `<div class="${className}">\n${content}\n</div>`;
  },

  // generate a <script> element either for plain text or an IIFE
  script: function (fn) {
    if (typeof fn === `string`) return `\n<script>\n${fn}\n</script>`;
    return `\n<script>\n(${fn.toString()})();\n</script>`;
  },

  // generate a <style> element
  style: function (css) {
    return `<style>${css}</style>`;
  },
};

/*****************************************************************
 *                                                               *
 *                   TEMPLATING: GENERATORS                      *
 *                                                               *
 *****************************************************************/

const Generator = {
  /**
   * A very simple HTML document builder
   */
  page: function (path, isDir, root = false) {
    if (isDir) {
      const content = readdirSync(path).filter((e) =>
        Utils.filterForImage(path, e),
      );
      const hasImages = Utils.isGalleryDir(path);
      if (!hasImages) {
        // standard dir listing
        return Template.create(path, Generator.dirListing(path, content, root));
      }
      // image gallery
      Utils.sortDirContent(path, content);
      return Template.create(path, Generator.gallery(path, content));
    }
    // ...what was this???
    return Template.create(path);
  },

  /**
   * Generate the gallery HTML.
   */
  gallery: function (path, content) {
    const title = path.split(`/`).at(-2);
    const topRow = `<a href="..">[↰ up]</a></span><h1>${title}</h1><button class="delete">delete</button>`;
    return `
    ${Template.style(CSS.gallery)}
    ${topRow}
    ${Template.div(content.map(Template.img).join(`\n      `), `gallery`)}
    ${Template.script(`const concurrency = ${concurrency};`)}
    ${Template.script(ClientSide.imageNavigation)}
    ${Template.script(ClientSide.deleteFolder)}
  `;
  },

  /**
   * Generate an HTML dir listing.
   */
  dirListing: function (path, content, root) {
    const topRow = `<p>${root ? `` : `<a href="..">[↰ up]</a>`}</p>`;
    let haveCovers = false;
    const items = content
      .map((e) => {
        const isDir = statSync(path + `/` + e).isDirectory();
        const href = `./${encodeURIComponent(e)}/`;
        const label = `${isDir ? `📁 ` : ``}${e}`;
        let first = readdirSync(path + `/` + e)?.[0];
        if (!Utils.isImage(first)) {
          first = undefined;
        } else {
          first = `<img src="${href + encodeURIComponent(first)}">`;
          haveCovers = true;
        }
        return `<li>${Template.a(href, label, first)}</li>`;
      })
      .join(`\n      `);

    return `
    ${Template.style(CSS.dirlisting)}
    ${topRow}
    <ol class="dirlist ${haveCovers ? `with-covers` : ``}">
      ${items}
    </ol>
    ${Template.script(ClientSide.goUpKeyHandler)}
    ${Template.script(ClientSide.zipfileHandler)}
  `;
  },
};

/*****************************************************************
 *                                                               *
 *                   CLIENT-SIDE SCRIPTS                         *
 *                                                               *
 *****************************************************************/

const ClientSide = {
  /**
   * Add file-drop handling.
   *
   * This function gets IIFE templated into dir listing pages.
   */
  zipfileHandler: function zipfileHandler(path = globalThis.path) {
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      window.addEventListener(eventName, (e) => e.preventDefault(), false);
    });

    window.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadFiles(e.dataTransfer.files ?? []);
    });

    async function submit(file, path) {
      try {
        const response = await fetch(
          `/upload?name=${encodeURIComponent(file.name)}&path=${path}`,
          {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
          },
        );
        const result = await response.json();
        console.log("Upload successful:", result);
      } catch (error) {
        console.error("Upload failed:", error);
      }
    }

    async function uploadFiles(files) {
      if (!files || files.length === 0) return;
      await Promise.all([...files].map((file) => submit(file, path)));
      location.reload();
    }
  },

  /**
   * Navigate to the current URL's parent path.
   *
   * This function gets IIFE templated into all pages.
   */
  goUp: function goUp() {
    const newURL = location.toString().replace(/[^\/]+\/?$/, ``);
    if (newURL === `http://`) return;
    window.location.href = newURL;
  },

  /**
   * Trigger a "go up" action based on key input.
   *
   * This function gets IIFE templated into all pages.
   */
  goUpKeyHandler: function goUpKeyHandler() {
    document.addEventListener(`keydown`, (evt) => {
      const { key } = evt;
      if (key === `Escape` || key === `ArrowUp`) {
        evt.preventDefault();
        goUp();
      }
    });
  },

  /**
   * Add image navigation to all <img> on the page.
   *
   * This function gets IIFE templated into gallery pages.
   */
  imageNavigation: function imageNavigation() {
    let fullscreen;
    const imgs = [...document.querySelectorAll(`img`)];

    // un-fullscreen a gallery view
    function unload(bypassHistory = false) {
      if (fullscreen) {
        const img = fullscreen;
        fullscreen.classList.remove(`full`);
        fullscreen = undefined;
        setTimeout(() => img.scrollIntoView(), 1);
      }
      if (!bypassHistory) history.pushState({}, ``, `./`);
    }

    // load an image full screen
    function load(idx, bypassHistory = false) {
      if (idx === false) return unload();
      fullscreen?.classList.remove(`full`);
      fullscreen = imgs[idx];
      fullscreen?.classList.add(`full`);
      if (!bypassHistory) history.pushState({}, ``, `./${idx}`);
    }

    // show the previous image
    function prev(pos = imgs.indexOf(fullscreen)) {
      if (pos > 0) load(pos - 1);
    }

    // show the next image
    function next(pos = imgs.indexOf(fullscreen)) {
      if (pos < imgs.length - 1) load(pos + 1);
    }

    // either exit fullscreen or go up a dir, depending on
    // whether or not we're looking at a full screen image
    function cancel(evt) {
      evt?.preventDefault();
      fullscreen ? load(false) : goUp();
    }

    // Key handling...
    document.addEventListener(`keydown`, (evt) => {
      const { key } = evt;
      if (key === `Escape` || key === `ArrowUp`) cancel(evt);
      if (key === `ArrowLeft` || key === `PageUp`)
        fullscreen ? prev() : load(imgs.length - 1);
      if (key === `ArrowRight` || key === `PageDown`)
        fullscreen ? next() : load(0);
      if (key === `Home`) load(0);
      if (key === `End`) load(imgs.length - 1);
    });

    // Click handling...
    document.addEventListener(`click`, (evt) => {
      const img = evt.target;

      // Is this a "show image" request?
      let pos = -1;
      if (img.tagName === `IMG`) {
        pos = imgs.indexOf(img);
        if (!fullscreen && pos >= 0) {
          return load(pos);
        }
      }

      // If not, is this a fullscreen interaction?
      if (fullscreen) {
        pos = imgs.indexOf(fullscreen);
        const rx = evt.pageX / innerWidth;
        const ry = evt.pageY / innerHeight;
        if (ry < 0.25) return cancel();
        if (rx < 0.5) prev(pos);
        if (rx > 0.5) next(pos);
      }
    });

    // And popstate handling, so we do the right thing
    // on navigations with and without image suffixes.
    window.addEventListener(`popstate`, (event) => {
      const bypass = true;
      const loc = location.toString().split(`/`);
      const last = loc.at(-1);
      if (!last && fullscreen) {
        unload(bypass);
      } else if (last) {
        load(parseFloat(last), bypass);
      }
    });

    // Then: do we need to immediately load an image?
    const loadPos = parseFloat(location.toString().match(/\d+$/)?.[0]);
    if (!isNaN(loadPos)) {
      const img = imgs[loadPos];
      img.src = img.dataset.src;
      load(loadPos);
    }

    // And irrespective of whether we did or not, start loading
    // all images in this dir, one by one, in sequence. We don't
    // want a million URLs all firing at the same time, loading
    // things completely out of order.
    const loadList = Array.from(imgs);

    function loadImages() {
      if (loadList.length === 0) return;
      const img = loadList.shift();
      if (img.src) return loadImages();
      img.onload = () => {
        img.classList.remove(`loading`);
        loadImages();
      };
      img.classList.add(`loading`);
      img.src = img.dataset.src;
    }

    for (let i = 0; i < concurrency; i++) loadImages();
  },

  /**
   * "Delete folder" functionality in gallery views.
   *
   * This function gets IIFE templated into gallery pages.
   */
  deleteFolder: function deleteFolder(path = globalThis.path) {
    const del = document.querySelector(`button.delete`);
    del.addEventListener(`click`, async () => {
      let yes = confirm(`Delete folder?`);
      if (yes) {
        yes = confirm(`Really delete folder? (There is NO undelete)`);
        if (yes) {
          const response = await fetch(`/delete?path=${path}`, {
            method: "DELETE",
          });
          const result = await response.json();
          if (result.success) {
            location.href = "../";
          } else {
            alert(result.reason ?? `Unknown error occurred`);
          }
        }
      }
    });
  },
};

/*****************************************************************
 *                                                               *
 *                 GENERAL HELPER FUNCTIONS                      *
 *                                                               *
 *****************************************************************/

const Utils = {
  /**
   * A helper function to determine if a dir is a gallery dir or
   * just a dir that happens to maybe have some images in it.
   */
  isGalleryDir: function (path) {
    const content = readdirSync(path).filter((e) =>
      Utils.filterForImage(path, e),
    );
    let [images, dirs] = [0, 0];
    content.forEach((file) => {
      const s = statSync(`${path}/${file}`);
      if (s.isDirectory()) {
        dirs++;
      } else if (Utils.isImage(file)) {
        images++;
      }
    });
    return images > 0 && dirs === 0;
  },

  /**
   * A helper function to determine whether a URL or file path
   * counts as "this is an image" or not.
   */
  isImage: function (string) {
    if (!string) return false;
    return formats.find((format) =>
      string.toLowerCase().endsWith(`.${format.toLowerCase()}`),
    );
  },

  /**
   * A filter function that keeps all dirs and images in a
   * dir listing, but removes everything else.
   */
  filterForImage: function (path, e) {
    if (unwantedDataPaths.includes(e)) {
      // Some file/dir paths are too stupid to allow, so if we
      // see them, we immediately force-delete them.
      rmSync(`${path}/${e}`, { recursive: true, force: true });
      return false;
    }

    return statSync(`${path}/${e}`).isDirectory() || Utils.isImage(e);
  },

  /**
   * Sort directory content - dirs go first, after
   * that images get sorted based on numerical suffix
   */
  sortDirContent: function (path, content) {
    content.sort((a, b) => {
      const naiveSort = a < b ? -1 : a > b ? 1 : 0;

      // Are one or both directories?
      const sa = statSync(`${path}/${a}`).isDirectory();
      const sb = statSync(`${path}/${b}`).isDirectory();
      if (sa && sb) return naiveSort;
      if (sa) return -1;
      if (sb) return 1;

      // If not, find the numerical suffix and sort on that.
      const r = new RegExp(`\\d+\\.(${formats.join(`,`)})$`);
      const ia = parseFloat(a.match(r));
      const ib = parseFloat(b.match(r));
      if (isNaN(ia) || isNaN(ib)) return naiveSort;
      return ia - ib;
    });
  },
};
/*****************************************************************
 *                                                               *
 *                   MAIN WEB SERVER CODE                        *
 *                                                               *
 *****************************************************************/

(function startBrowsing() {
  const server = createServer(routeHandler);
  server.listen(port, () => console.log(`server listening on port ${port}`));

  /**
   * Route handling either yields a dir listing, and image gallery,
   * or actual images, depending on the URL and what it maps to.
   */
  function routeHandler(req, res) {
    let { url } = req;
    url = decodeURIComponent(url);
    if (url.includes(`favicon`)) return res.end();

    // zip file upload?
    if (url.startsWith(`/upload`)) {
      return handleUpload(req, res);
    }

    // folder deletion?
    if (url.startsWith(`/delete`)) {
      return deleteFolderFromFS(req, res);
    }

    // Static asset or dir request?
    const imageExtension = Utils.isImage(url);

    if (!url.endsWith(`/`) && !imageExtension) {
      // Is this a direct "show me this image" line?
      const imageIndex = parseFloat(url.match(/\d+$/)?.[0]);
      if (!isNaN(imageIndex)) {
        url = url.substring(0, url.lastIndexOf(`/`) + 1);
      }
      // Redirect to the correct dir URL if this is a dir request without / suffix
      else {
        res.writeHead(302, { Location: encodeURI(url) + `/` });
        return res.end();
      }
    }

    // Construct the local file path and see what we need to do:
    const path = base + url;

    // Images are served as static content.
    if (imageExtension) {
      res.writeHead(200, {
        [contentType]: `image/${imageExtension}`,
        [cacheControl]: `max-age=${imageCacheDuration}`,
      });
      try {
        return res.end(readFileSync(path));
      } catch (e) {
        return res.end();
      }
    }

    // Dirs are served as a "folder view".
    try {
      const isDir = statSync(path).isDirectory();
      if (!isDir) throw new Error(`not a dir`);
      const html = Generator.page(path, isDir, url === `/`);
      res.writeHead(200, { [contentType]: `text/HTML` });
      res.end(`<!doctype html>\n${html}`);
    } catch (e) {
      console.warn(e);
      res.end();
    }
  }

  /**
   * Handle zip file upload(s) into a dir, unpacking
   * them to their own subdir using the z7 CLI.
   */
  function handleUpload(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const name = url.searchParams.get(`name`);

    if (!name.endsWith(`.zip`)) {
      res.writeHead(400, { [contentType]: `plain/text` });
      return res.end(`ERROR: Upload is not a zip file.`);
    }

    const stripped = name.replace(`.zip`, ``);
    const path = url.searchParams.get(`path`);
    const filepath = path + name;
    const folderpath = path + stripped;

    if (existsSync(folderpath)) {
      res.writeHead(400, { [contentType]: `plain/text` });
      return res.end(`ERROR: Folder already exists.`);
    }

    const stream = createWriteStream(filepath);

    req.pipe(stream);

    stream.on("finish", () => {
      const unpack = [
        `cd "${path}"`,
        `7z x "${name}" -o"${stripped}"`,
        `rm "${name}"`,
      ].join(` && `);
      const unpacked = execSync(unpack, { encoding: `utf-8` });
      res.writeHead(200, { [contentType]: `application/json` });
      res.end(JSON.stringify({ name, path, unpacked }));
    });
  }

  /**
   * Handle a folder delete request. Obviously, reject any
   * path that's not rooted wherever browse.js itself lives,
   * but also reject any path that isn't an image folder.
   */
  function deleteFolderFromFS(req, res) {
    if (req.method !== `DELETE`) {
      res.writeHead(400, { [contentType]: `application/json` });
      return res.end(JSON.stringify({ success: false, reason: `wrong verb` }));
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = normalize(url.searchParams.get(`path`));
    const respond = (reason) => {
      res.writeHead(reason ? 400 : 200, { [contentType]: `application/json` });
      res.end(JSON.stringify({ success: !reason, reason }));
    };

    // Illegal dir?
    if (!path.includes(base)) {
      return respond(`unknown folder`);
    }

    // Not a gallery dir?
    if (!Utils.isGalleryDir(path)) {
      return respond(`not a gallery folder`);
    }

    rmSync(path, { recursive: true, force: true });
    respond();
  }
})();
