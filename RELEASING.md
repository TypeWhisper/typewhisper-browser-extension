# Releasing

A release is a pull request that raises the version. When it is merged and CI passes on `main`, the [Release workflow](.github/workflows/release.yml) does the rest.

## Release a new version

1. On a new branch, run `npm version patch` (or `minor`, `major`). It sets the version in `package.json`, `package-lock.json` and `extension/manifest.json` and adds a heading for it to `CHANGELOG.md`.
2. List the user-visible changes under that heading. `npm test` fails until the section has notes.
3. Open a pull request and merge it once CI passes.

The Release workflow then:

- creates the tag `v<version>` and a GitHub release with the changelog section and both store ZIPs,
- submits the Firefox package to Firefox Add-ons, with the changelog section as release notes,
- uploads the Chrome package to the Chrome Web Store and submits it for review.

Both stores publish the version once their review approves it. If a submission fails, re-run the failed job, or start the Release workflow by hand on `main` to submit the current version to both stores again.

## Store access

Each store is skipped until its repository variable is set (**Settings › Secrets and variables › Actions**).

| Store | Variable | Secret |
| --- | --- | --- |
| Firefox Add-ons | `AMO_API_KEY`: JWT issuer | `AMO_API_SECRET`: JWT secret |
| Chrome Web Store | `CHROME_PUBLISHER_ID` | `CHROME_SERVICE_ACCOUNT_KEY`: JSON key of the service account |

- **Firefox Add-ons:** generate the credentials under [Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) with the account that owns the add-on.
- **Chrome Web Store:** in Google Cloud, enable the Chrome Web Store API, create a service account without roles, and create a JSON key for it. In the [developer dashboard](https://chrome.google.com/webstore/devconsole), add the service account's email under **Account**. The publisher ID is in the publisher settings.

## Manual upload

`npm run build` writes `dist/typewhisper-chrome-<version>.zip` and `dist/typewhisper-firefox-<version>.zip`.

- **Chrome Web Store:** open the item in the developer dashboard, choose **Package › Upload new package**, then **Submit for review**.
- **Firefox Add-ons:** open the add-on in the Developer Hub, choose **Upload New Version**, answer **No** to the source code question (the package is not minified or bundled), and paste the changelog section as release notes.
