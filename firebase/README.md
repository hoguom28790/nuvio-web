# Trakt auth bridge on Firebase Functions

Lets the statically hosted NuvioWeb (GitHub Pages) sign in to Trakt and
refresh tokens, so watch progress can be scrobbled to Trakt. The Trakt client
secret stays in Firebase Secret Manager; the browser only receives tokens.

Project: `personal-movies` (see `.firebaserc`). Region: `asia-southeast1`.
Requires the Blaze plan (pay as you go) for Cloud Functions and Secret Manager.

## One-time setup

1. Create a Trakt app at https://app.trakt.tv/settings/apps with redirect URI
   `urn:ietf:wg:oauth:2.0:oob`. Keep the Client ID and Client Secret.
2. Install the CLI and sign in: `npm i -g firebase-tools && firebase login`.
3. Store the secrets (you are prompted for the value; never commit them):
   ```bash
   cd firebase
   firebase functions:secrets:set TRAKT_CLIENT_ID
   firebase functions:secrets:set TRAKT_CLIENT_SECRET
   ```
4. Deploy:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
   The function URL is
   `https://asia-southeast1-personal-movies.cloudfunctions.net/trakt`.
   Check `<url>/health` returns `{"configured":true}`.

`functions/.env` sets `ALLOWED_ORIGINS` (comma separated) to the sites that may
call the function. Change it if your site is not on `hoguom28790.github.io`.

## Point the web app at it

In `local.example.properties` (or `local.properties`) set:

```
TRAKT_CLIENT_ID=<your Trakt client id>
TRAKT_AUTH_BRIDGE_URL=https://asia-southeast1-personal-movies.cloudfunctions.net/trakt
```

Then push to `main` to redeploy GitHub Pages. In the app: Settings -> Trakt ->
Connect, scan the QR code or enter the code at trakt.tv/activate.

## Tests

`node --test firebase/functions/handler.test.mjs`
