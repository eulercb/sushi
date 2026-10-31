# GitHub Pages and offline installation

The deployment workflow tests and builds every push to `main`, then publishes `dist` through GitHub Pages. It can also be run from Actions → Deploy Sushi Loop → Run workflow. Node 22 and the committed npm lockfile provide a reproducible dependency installation.

## One-time repository setup

In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. This requires repository administration access. If the repository or organization restricts Actions, allow the official `actions/checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact` and `deploy-pages` actions. The workflow grants its deployment token `pages: write` and `id-token: write`; no personal token is required. Allow deployments to the `github-pages` environment if its protection rules require review.

Push to `main` or run the workflow manually, then open the deployment URL displayed in Actions. For a repository named `sushi`, the site is `https://OWNER.github.io/sushi/`. An unsuccessful configure-pages step usually means Pages has not yet been enabled with GitHub Actions as the source.

## Custom domain

The repository's Pages custom domain is `sushi.zen.dev.br`. At your DNS provider, the subdomain record should be a **CNAME** with name `sushi` and target `eulercb.github.io`, without a repository name or URL path. In **Settings → Pages**, the custom domain is already set; keep HTTPS enabled once GitHub has issued the certificate. An Actions deployment does not require a `CNAME` file in the repository.

The workflow reads the site's base path from `actions/configure-pages` before building. It uses `/` for a custom domain and `/sushi/` for the default GitHub project URL, and runs the browser tests with the same path. Changing the hostname changes the browser origin: saved rankings and installed apps do not automatically migrate from the old hostname.

## Local production verification

Run `npm ci`, `npm test`, `npm run build`, and `npm run preview`. The CI workflow also installs Chromium and runs `npm run test:e2e` against the production bundle. Open `http://localhost:4173/sushi/`. The development server intentionally does not register a service worker. To publish at a domain root, build with `BASE_PATH=/ npm run build`; a different project path can be supplied the same way, including leading and trailing slashes.

To verify the custom-domain root locally, run `BASE_PATH=/ npm run build` followed by `BASE_PATH=/ npm run test:e2e`. For manual inspection, run `BASE_PATH=/ npm run preview` and open `http://localhost:4173/`.

Open the production page online once, wait for the service worker to finish installing, and reload it. In browser DevTools, switch the Network panel to Offline and reload again. The game, icons, help and settings should remain available. Restore networking before checking a new release. Service workers require HTTPS, except on localhost.

## Install and updates

On supporting browsers, an Install button appears when the browser supplies an installation prompt. On iPhone or iPad, open the site in Safari, choose Share → Add to Home Screen. Installation availability depends on the browser; playing in an ordinary tab always works.

Every build hashes the complete offline bundle and worker source into a new cache version. Installation downloads the whole release and rejects incomplete downloads. The new worker activates after the download, without reloading an open game. Choose **Update & restart** to load the new release; older pages without that button receive it on a subsequent reload. Navigation uses the cached shell with the matching hashed assets. Activation keeps the current cache and the most recent complete previous cache within this app's deployment scope, so open pages can still request their older assets. It does not cache external traffic, API calls, or unknown assets. Local saved progress belongs to the origin and remains separate from the service worker cache; clearing site data removes it.
