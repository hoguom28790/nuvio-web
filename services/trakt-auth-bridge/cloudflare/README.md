# Trakt auth bridge on Cloudflare Workers

Lets a statically hosted NuvioWeb (GitHub Pages) sign in to Trakt. The client
secret stays in the Worker; the browser only sees tokens.

1. Create a Trakt app at https://app.trakt.tv/settings/apps (redirect URI `urn:ietf:wg:oauth:2.0:oob`).
2. Deploy:
   ```bash
   cd services/trakt-auth-bridge/cloudflare
   npx wrangler deploy worker.js --name nuvio-trakt-bridge --compatibility-date 2024-01-01
   npx wrangler secret put TRAKT_CLIENT_ID
   npx wrangler secret put TRAKT_CLIENT_SECRET
   ```
   Set variable `ALLOWED_ORIGIN` to your site origin (e.g. `https://<user>.github.io`).
3. In `local.example.properties` (or `local.properties`) set:
   ```
   TRAKT_CLIENT_ID=<client id>
   TRAKT_AUTH_BRIDGE_URL=https://nuvio-trakt-bridge.<account>.workers.dev
   ```
4. Push to `main` to redeploy Pages.
