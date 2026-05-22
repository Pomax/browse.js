/**
 * # Browse dot js
 *
 * A super-simple but super-useful image browsing script.
 * Run as `node browse.js` in whatever toplevel dir houses
 * all your images, and then just fire up http:/localhost:8080
 *
 * ## Requirements
 *
 *  - Node 22 or newer
 *  - 7z CLI utility
 *
 * ## Code notes
 *
 * This code is organized in blocks that any IDE should be able
 * to collapse/expand as needed to keep it easy to work on.
 *
 * ## How to run
 *
 * Simply run `node browse` in the folder that you've placed
 * browse.js in. It will treat its own folder as root, and
 * allow you to browser any subfolder as either a dir listing
 * (if there are no images in it) or gallery (if there are).
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
 * Either hit up the issue tracker over on
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

const port = 8080;
const base = normalize(import.meta.dirname);
const npm = process.platform === `win32` ? `npm.cmd` : `npm`;
const unwantedDataPaths = [`@eaDir`, `.DS_Store`, `Thumbs.db`];
const formats = [`jpg`, `jpeg`, `png`, `webp`];
const contentType = `Content-Type`;
const cacheControl = `Cache-Control`;
const imageCacheDuration = 604800;
const concurrency = 5;

/*****************************************************************
 *                                                               *
 *                      TEMPLATING: CSS                          *
 *                                                               *
 *****************************************************************/

const pageCSS = `html {
  font-size: 2vh!important;

  a, a:active, a:hover, a:visited {
    color: blue;
  }
`;

const dirlistCSS = `html {
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
`;

const galleryCSS = `html {
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
`;

/*****************************************************************
 *                                                               *
 *                      TEMPLATING: CODE                         *
 *                                                               *
 *****************************************************************/

// generate an image with a lazy-load data attribute instead of src attribute
function img(src, position) {
  return `<img id="img-${position}" width="200" height="300" title="${src}" data-src="./${encodeURIComponent(src)}">`;
}

// generate a link
function a(href, label = href, img = ``) {
  return `<a href="${href}">${img}${label}</a>`;
}

// generate a <div> element
function div(content, className = ``) {
  return `<div class="${className}">\n${content}\n</div>`;
}

// generate a <script> element either for plain text or an IIFE
function script(fn) {
  if (typeof fn === `string`) return `\n<script>\n${fn}\n</script>`;
  return `\n<script>\n(${fn.toString()})();\n</script>`;
}

// generate a <style> element
function style(css) {
  return `<style>${css}</style>`;
}

// our main document scaffolding
function template(path, content) {
  return `<html lang="en" translate="no">
  <head>
    <meta charset="utf-8">
    <title>${path.match(/[^\/]+\/?$/)?.[0]?.replaceAll(`/`, ``)}</title>
    ${style(pageCSS)}
    <script>globalThis.path = "${encodeURIComponent(path)}";</script>
  </head>
  <body>
    ${script(goUp.toString())}
    ${content}
  </body>
</html>
  `;
}

/**
 * A very simple HTML document builder
 */
function createPage(path, isDir, root = false) {
  if (isDir) {
    const content = readdirSync(path).filter((e) => filterForImage(path, e));
    const hasImages = isGalleryDir(path);
    if (!hasImages) {
      // standard dir listing
      return template(path, generateDirListing(path, content, root));
    }
    // image gallery
    sortDirContent(path, content);
    return template(path, generateGallery(path, content));
  }
  // ...what was this???
  return template(path);
}

/**
 * Generate the gallery HTML.
 */
function generateGallery(path, content) {
  const title = path.split(`/`).at(-2);
  const topRow = `<a href="..">[↰ up]</a></span><h1>${title}</h1><button class="delete">delete</button>`;
  return `
    ${style(galleryCSS)}
    ${topRow}
    ${div(content.map(img).join(`\n      `), `gallery`)}
    ${script(`const concurrency = ${concurrency};`)}
    ${script(imageNavigation)}
    ${script(deleteFolder)}
  `;
}

/**
 * Generate an HTML dir listing.
 */
function generateDirListing(path, content, root) {
  const topRow = `<p>${root ? `` : `<a href="..">[↰ up]</a>`}</p>`;
  let haveCovers = false;
  const items = content
    .map((e) => {
      const isDir = statSync(path + `/` + e).isDirectory();
      const href = `./${encodeURIComponent(e)}/`;
      const label = `${isDir ? `📁 ` : ``}${e}`;
      let first = readdirSync(path + `/` + e)?.[0];
      if (!isImage(first)) {
        first = undefined;
      } else {
        first = `<img src="${href + encodeURIComponent(first)}">`;
        haveCovers = true;
      }
      return `<li>${a(href, label, first)}</li>`;
    })
    .join(`\n      `);

  return `
    ${style(dirlistCSS)}
    ${topRow}
    <ol class="dirlist ${haveCovers ? `with-covers` : ``}">
      ${items}
    </ol>
    ${script(goUpKeyHandler)}
    ${script(zipfileHandler)}
  `;
}

/*****************************************************************
 *                                                               *
 *                   CLIENT-SIDE SCRIPTS                         *
 *                                                               *
 *****************************************************************/

/**
 * Add file-drop handling.
 *
 * This function gets IIFE templated into dir listing pages.
 */
function zipfileHandler(path = globalThis.path) {
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
}

/**
 * Navigate to the current URL's parent path.
 *
 * This function gets IIFE templated into all pages.
 */
function goUp() {
  const newURL = location.toString().replace(/[^\/]+\/?$/, ``);
  if (newURL === `http://`) return;
  window.location.href = newURL;
}

/**
 * Trigger a "go up" action based on key input.
 *
 * This function gets IIFE templated into all pages.
 */
function goUpKeyHandler() {
  document.addEventListener(`keydown`, (evt) => {
    const { key } = evt;
    if (key === `Escape` || key === `ArrowUp`) {
      evt.preventDefault();
      goUp();
    }
  });
}

/**
 * Add image navigation to all <img> on the page.
 *
 * This function gets IIFE templated into gallery pages.
 */
function imageNavigation() {
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
    img.src = encodeURIComponent(img.dataset.src);
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
}

/**
 * "Delete folder" functionality in gallery views.
 *
 * This function gets IIFE templated into gallery pages.
 */
function deleteFolder(path = globalThis.path) {
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
}

/*****************************************************************
 *                                                               *
 *                 GENERAL HELPER FUNCTIONS                      *
 *                                                               *
 *****************************************************************/

/**
 * A helper function to determine if a dir is a gallery dir or
 * just a dir that happens to maybe have some images in it.
 */
function isGalleryDir(path) {
  const content = readdirSync(path).filter((e) => filterForImage(path, e));
  let [images, dirs] = [0, 0];
  content.forEach((file) => {
    const s = statSync(`${path}/${file}`);
    if (s.isDirectory()) {
      dirs++;
    } else if (isImage(file)) {
      images++;
    }
  });
  return images > 0 && dirs === 0;
}

/**
 * A helper function to determine whether a URL or file path
 * counts as "this is an image" or not.
 */
function isImage(string) {
  if (!string) return false;
  return formats.find((format) =>
    string.toLowerCase().endsWith(`.${format.toLowerCase()}`),
  );
}

/**
 * A filter function that keeps all dirs and images in a
 * dir listing, but removes everything else.
 */
function filterForImage(path, e) {
  if (unwantedDataPaths.includes(e)) {
    // Some file/dir paths are too stupid to allow, so if we
    // see them, we immediately force-delete them.
    rmSync(`${path}/${e}`, { recursive: true, force: true });
    return false;
  }

  return statSync(`${path}/${e}`).isDirectory() || isImage(e);
}

/**
 * Sort directory content - dirs go first, after
 * that images get sorted based on numerical suffix
 */
function sortDirContent(path, content) {
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
}

/*****************************************************************
 *                                                               *
 *                      WEB SERVER CODE                          *
 *                                                               *
 *****************************************************************/

/**
 * Our "main" function, because why not.
 */
(function main() {
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
    const imageExtension = isImage(url);

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
      const html = createPage(path, isDir, url === `/`);
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
    if (!isGalleryDir(path)) {
      return respond(`not a gallery folder`);
    }

    rmSync(path, { recursive: true, force: true });
    respond();
  }
})();
