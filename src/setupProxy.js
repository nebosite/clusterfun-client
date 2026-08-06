/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const express = require("express");

// ==========================================================================================
// Dev-server middleware. CRA loads this file automatically when it exists.
//
// It exists to serve BACKGROUND MUSIC to the Test Lobby.
//
// Music is served by the relay server in production, from clusterfun-server/hosted_content/
// music - so `npm start` on its own had nothing behind /music, the dev server's proxy to
// :8080 answered 500 (ECONNREFUSED), and every presenter reported "No music installed" while
// the tracks sat on disk a directory away. The Test Lobby is deliberately serverless, so
// "just run the relay too" is the one instruction it exists to avoid.
//
// This mirrors what clusterfun_server_main.ts does with the same folder: a generated manifest
// at /music/music.json and the files themselves underneath. The manifest is rebuilt per
// request, so dropping a track into the folder makes it appear on the next reload.
// ==========================================================================================

// Must match MUSIC_SCHEMA_VERSION in libs/Media/MusicLibrary.ts and the server's copy - the
// client drops a manifest whose schema it does not recognise.
const MUSIC_SCHEMA_VERSION = 1;
const AUDIO_EXTENSIONS = new Set([".m4a", ".mp3", ".ogg", ".wav", ".aac", ".flac"]);

const MUSIC_FOLDER =
  process.env.CLUSTERFUN_MUSIC_PATH ??
  path.resolve(__dirname, "..", "..", "clusterfun-server", "hosted_content", "music");

/** Same shape the server's MusicCatalog builds. */
function buildManifest() {
  let names = [];
  try {
    names = fs.readdirSync(MUSIC_FOLDER);
  } catch {
    return { schema: MUSIC_SCHEMA_VERSION, version: "empty", tracks: [] };
  }

  const tracks = [];
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (!AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
    let stat;
    try {
      stat = fs.statSync(path.join(MUSIC_FOLDER, name));
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    tracks.push({
      id: path.basename(name, path.extname(name)),
      file: name,
      title: path.basename(name, path.extname(name)),
      seconds: 0,
      bytes: stat.size,
      // Cheap (size, mtime) token rather than a content hash. The server upgrades to a real
      // hash in the background; in dev all this has to do is change when the file does.
      hash: `${stat.size}-${Math.floor(stat.mtimeMs)}`,
    });
  }
  return { schema: MUSIC_SCHEMA_VERSION, version: `dev-${tracks.length}`, tracks };
}

module.exports = function (app) {
  app.get("/music/music.json", (_req, res) => {
    // The one music URL that changes: it must be re-validated, or a new track never appears.
    res.setHeader("Cache-Control", "no-cache");
    res.json(buildManifest());
  });
  app.use("/music", express.static(MUSIC_FOLDER));
};
