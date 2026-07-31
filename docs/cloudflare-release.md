# Owner-controlled Cloudflare release

The public production path is a Cloudflare Worker and D1 database owned by
Anish. The existing Sites deployment remains private and unchanged as a
rollback environment. Do not request a workspace policy change, publish a
Sites bypass token, or proxy the private Sites deployment.

## One-time account setup

1. Authenticate Wrangler with the owner Cloudflare account: `npx wrangler login`.
2. Create D1: `npx wrangler d1 create anish-shah-work-in-public`.
3. In Cloudflare Zero Trust, create a self-hosted Access application covering
   `/studio*` and `/api/studio/*` on the Worker hostname. Use One-time PIN and
   allow only the owner email. Record the team domain and application AUD.
4. Keep the repository private and do not add an open-source license.

Access is enforced twice: Cloudflare validates the session at the edge, and the
Worker verifies the JWT signature, issuer, audience, expiry, and email before
the application applies its exact `OWNER_EMAILS` allowlist.

## Prepare one immutable build

Use a clean shell without `LOCAL_OWNER_EMAIL`:

```bash
export CLOUDFLARE_D1_DATABASE_ID='<uuid returned by D1 create>'
export CLOUDFLARE_D1_DATABASE_NAME='anish-shah-work-in-public'
export PUBLIC_SITE_URL='https://anish-shah-work-in-public.<account>.workers.dev'
export OWNER_EMAILS='<exact owner email>'
export CF_ACCESS_TEAM_DOMAIN='https://<team>.cloudflareaccess.com'
export CF_ACCESS_AUD='<Access application audience>'
npm run cloudflare:prepare
```

The preparation step starts from Vinext’s generated Worker configuration and
writes `dist/server/wrangler.public.json`. It includes only reviewed non-secret
values. The D1 binding is `DB`; migrations remain the checked-in files under
`drizzle/`.

Set secrets interactively. Never put these values in GitHub, a command log, or
the generated config:

```bash
npx wrangler secret put CONNECTOR_ENCRYPTION_KEY --config dist/server/wrangler.public.json
npx wrangler secret put RATE_LIMIT_SALT --config dist/server/wrangler.public.json
```

The production connector encryption key is durable state: back it up securely
and do not rotate it during an ordinary release. Use at least 32 random bytes
for the independent rate-limit salt.

## Migrate, deploy, and verify

```bash
npm run security:audit
npm test
npm run cloudflare:migrate
npm run cloudflare:deploy
```

After deployment, register the exact Worker callback URL with the production
MyAnimeList client, complete production OAuth, promote or re-enter the other
credentials through the Access-protected Studio, refresh each stream, and
smoke-test from a logged-out browser. Anonymous public pages must succeed;
Studio and every `/api/studio/**` request must fail closed.

If any verification fails, leave the private Sites deployment unchanged and
roll back the Worker version from Cloudflare rather than weakening Access.
