"use strict";

const functions = require("firebase-functions/v1");
const { createHandler } = require("./handler");

// Secrets: `firebase functions:secrets:set TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET`.
// ALLOWED_ORIGINS (comma separated) comes from functions/.env, e.g.
// ALLOWED_ORIGINS=https://hoguom28790.github.io
exports.trakt = functions
  .region("asia-southeast1")
  .runWith({ secrets: ["TRAKT_CLIENT_ID", "TRAKT_CLIENT_SECRET"], maxInstances: 3 })
  .https.onRequest((req, res) => createHandler({ env: process.env })(req, res));
