# Maintaining Verlass

Notes for publishing Verlass and keeping it running. Everything here is done by hand in a browser or with the commands shown.

## Release checklist

1. Make changes in `docs/app/`, `gmail/`, or `scripts/`.
2. If it is a release, raise `VERSION` and set `RELEASE_DATE` in `scripts/site.config.mjs`, raise `version` in `package.json` to match, and add a section to `CHANGELOG.md`. The build stamps the download packages with `RELEASE_DATE`, so set it before building.
3. Run `npm run build` and `npm run check`. Both must pass. Each area has its own tests in `scripts/tests/` (core, gmail, web, pages, colors, packages, ui), and `npm run check -- --only=gmail` runs just one while you work on it. The check compares every generated file with a fresh build, so a changed source without a rebuild fails.
4. The `ui` tests drive the screens in headless Chrome. They need Google Chrome, Microsoft Edge, or Chromium (set `CHROME_PATH` to choose one). When no browser can start, they are skipped with a note; when the browser starts but the scenario hangs or fails, that is a failure. The GitHub check skips them on purpose (it says so in its log), so run them on your own computer before every release. Set `VERLASS_UI=1` to run them on CI too.
5. Commit and push to `main`. GitHub Pages publishes `docs/` within a minute or two.

Outlook users get the new version automatically, because Outlook loads Verlass from the website. Gmail users update by replacing the script files (the install page says how), so mention Gmail changes in the changelog.

## GitHub Pages and the custom domain

The site is published from the `main` branch, `/docs` folder (Settings, Pages).

Also turn on private vulnerability reporting (Settings, Code security, Private vulnerability reporting), which SECURITY.md tells people to use.

GitHub Pages lets browsers keep each file for about ten minutes, and the pages load several script files. Right after a release, someone can briefly get a mix of old and new files; the app and the demo then show "could not load" with a reload hint instead of an empty panel. Avoid releases that rename an export used across files while people are working, or wait for the ten minutes before announcing them.

The permanent address is `https://verlass.alyssaagard.dev`. The Outlook manifest, every organization's app registration, and the Gmail add-on's icon contain this address, so it should not change once people install Verlass. To connect it:

1. At Namecheap (the DNS host for alyssaagard.dev), open Domain List, Manage, then Advanced DNS, and add a record:
   - Type: `CNAME Record`
   - Host: `verlass`
   - Value: `alyssaagard.github.io.`
   - TTL: Automatic
2. Wait until `verlass.alyssaagard.dev` resolves (usually minutes, sometimes an hour).
3. In the repository, open Settings, then Pages. Under Custom domain, enter `verlass.alyssaagard.dev` and select Save. GitHub adds a `docs/CNAME` file.
4. When the certificate is ready, check Enforce HTTPS. Because `.dev` domains require HTTPS, the site only loads once this step is done.
5. Recommended: verify the domain for your GitHub account (your profile Settings, then Pages, then Add a domain) so no one else can claim the subdomain.

Until the custom domain is set, the site is also reachable at `https://alyssaagard.github.io/verlass/`, but the Outlook add-in and Microsoft sign-in only work at the permanent address.

To use a different address, change `SITE_URL` in `scripts/site.config.mjs`, run `npm run build`, and update the CNAME. Organizations that already installed the Outlook add-in must then update their app registration's redirect addresses and install a new manifest.

## Changing the name

The name is set in `scripts/site.config.mjs` (`NAME` and `SLUG`), and the build uses it for the pages, the packages, and the manifests. It also appears as plain text in source comments, in `README.md`, `CHANGELOG.md`, and this file, in `package.json` and `package-lock.json`, in a few strings in `gmail/*.gs` and `docs/app`, and in two sentences that explain the name (the home page in `scripts/pages.mjs` and the README). Names used only inside the code, such as browser storage keys, say `helpdesk` and do not change. To rename: change `NAME`, `SLUG`, `SITE_URL`, and `REPO_URL`, search the repository for the old name in both capital and small letters, run `npm install && npm run brand` for the new logo, then `npm run build` and `npm run check`.

## Real-world tests

The automated tests run the real code against simulated Google and Microsoft services. They cannot show how Gmail draws a card, how Google and Microsoft answer in practice, or how the admin centers behave. Before telling people a platform is ready, do these by hand and note the date in the changelog.

Gmail, Standard install (a free Gmail account is enough):

1. Follow the Standard install on the install page exactly as written. Note any step whose screen has changed.
2. First open: the setup card appears, **Create the help desk** makes a Sheet with eleven tabs, and you are on the Team tab as an administrator.
3. Send a request. Check the confirmation email, the row in the Tickets tab, and that a subject starting with `=` stays text in the Sheet.
4. As the team: open each queue, save a status, an assignee, a reply, and an internal note, set and clear a due time, and check the email to the requester.
5. With a second account that the Sheet is shared with: it sees only its own requests, can reply, close, and reopen. With an account the Sheet is not shared with: the card explains the problem.
6. Open Settings and save something in each group, each list, and one email. Edit a row in the Sheet and see it in the add-on after five minutes.
7. Turn on **Create from this email** (the install page, optional step), approve the new permission, and create a ticket from a message.
8. Things to look at closely, because only Gmail can show them: that quotation marks and line breaks look right on cards, that filled buttons take the accent color, that the logo loads, and that the card stack (Back) behaves after saving.

Gmail, Private install (needs two accounts in one Google Workspace domain; Google says test deployments are for people in the owner's organization, so two free accounts may not work, and that is worth noting too):

1. Follow the Private install exactly as written.
2. Before the owner opens the add-on, a second account is refused. After the owner sets it up, the second account works and has no access to the Sheet.
3. Email comes from the owner's account.
4. Look at the service project's Script properties: `ALLOWED_AUDIENCE` is filled in. This confirms that Google's sign-in token carries the add-on project's own client ID, which the service relies on. If it is empty or the add-on is refused with "made for a different add-on", report it; this is the one part of the Private install that could not be verified without a real account.
5. Set `ALLOWED_DOMAIN` and check that an outside account is refused.
6. If your organization blocks web apps open to "Anyone", note what Google shows.
7. Note the form of the web app address. If it contains `/a/<your domain>/macros/`, check that the add-on still reaches it; if not, the plain `/macros/s/.../exec` form of the same address should work.
8. Publish the add-on project for your organization (the install page), which moves it to a Google Cloud project. Check whether the service then refuses the add-on with "made for a different add-on"; if so, deleting `ALLOWED_AUDIENCE` in the service project and opening the add-on as the owner fixes it, and the guides already say so.
9. Check the setup with a stopwatch. Add-on actions must finish within 30 seconds. If creating the help desk from the add-on is cut off, run it again, or run `setupHelpDesk` from the editor.
10. Remove `https://www.googleapis.com/auth/gmail.addons.execute` from a copy of the manifest and see whether the add-on still runs. Google's current scope list no longer shows it; if it is not needed, drop it from `scripts/gmail-manifests.mjs`.

Outlook (needs a Microsoft 365 tenant where you are an administrator; the Microsoft 365 Developer Program offers a free test tenant to those who qualify):

1. Follow the Outlook install exactly as written: site, app registration, manifest, setup in the browser app, list permissions, deployment.
2. In the browser app: sign-in works, **1. Create the lists** grants the add-in access and creates three lists, **2. Create the help desk** saves the settings.
3. After the list permissions step, a requester sees only their own tickets, the team (site Owners on the Team list) sees all, and a requester cannot open the Help Desk Notes list. This confirms that Microsoft Graph honors SharePoint's item-level permissions for signed-in people, which Microsoft's documentation does not state outright. It also confirms that the add-in's site grant (`fullcontrol`, given in setup) lets Owners see every ticket; with a lower grant they could see only their own. Check the grant in Graph Explorer with `GET https://graph.microsoft.com/v1.0/sites/{site-id}/permissions`.
4. In Outlook on the web, new Outlook for Windows, classic Outlook for Windows, Outlook for Mac, and Outlook on a phone: the button appears on an open message, the panel opens and signs in without asking again, **Create from the open email** fills the form, and pinning keeps the panel open on the desktop clients.
5. On a client old enough to lack nested app authentication, the sign-in dialog opens and returns.
6. Email notices arrive, sent from the acting person's mailbox. With the manifest option "Do not send email", none are sent.
7. Upload the manifest in the Microsoft 365 admin center (Integrated apps) and note any validation message.
8. Run `npx office-addin-manifest validate docs/outlook/manifest.xml` after every change to the manifest. It asks Microsoft's own service to check it. It was last run on 2026-11-13 on the live manifest (version 2.0.0), which it reported valid for Outlook on Windows, Mac, the web, iOS, and Android. Inside a sandbox it may need `NODE_USE_ENV_PROXY=1` to reach Microsoft.
9. After setup, check that the step "Remove the setup permission" matches what the Microsoft Entra admin center shows, and correct the install page if the buttons differ.
10. On Outlook for iOS, Android, and Mac, check that the panel opens with its connection settings (they are in the address inside the manifest).
11. In the browser app, leave a tab open for more than a day and check that "Sign in again" appears and works.

## Search engines and link previews

The title, description, and link preview of every public page live in `scripts/seo.config.mjs`, together with the site name, the sharing image and its alt text, and the theme colors. `npm run build` writes them into each public page between the `seo:start` and `seo:end` comments in its head, and writes `docs/sitemap.xml`, `docs/robots.txt`, and `docs/site.webmanifest`. Edit the settings file, never the built pages.

- Keep each title under about 60 characters and each description between 70 and 160 characters, written as a plain sentence that says what the page is for. There is no keywords tag, because search engines ignore it.
- A new public page needs an entry in `SEO_PAGES`. Any other HTML page (the browser app, the Outlook task pane, the sign-in pages, the not found page) carries `<meta name="robots" content="noindex">`; pages built with `layout()` get it by passing `noindex: true`. The build refuses a page that is neither.
- The download packages and the Outlook manifest are not web pages, so they cannot carry a noindex tag. They are not in the sitemap, and nothing links to them from outside the install page.
- The seo test (`npm run check -- --only=seo`) checks the lengths, that each page has one title, description, and canonical address, that the tags match a fresh build, that every icon and the sharing image exist at the sizes they claim, that the structured data is valid, that the sitemap lists exactly the public pages, and that every other page says noindex.

Search engines find the site on their own in time, but asking them is faster. These steps need your own Google and Microsoft accounts:

1. In [Google Search Console](https://search.google.com/search-console), add a property. The **Domain** kind (`verlass.alyssaagard.dev`) asks you to add a TXT record at Namecheap: Domain List, Manage, Advanced DNS, Add new record, type TXT Record, host `verlass`, and the value Google shows. The **URL prefix** kind (`https://verlass.alyssaagard.dev/`) can instead be verified with an HTML file that Google gives you; send me the file name and its one line of text, and I can add it to `docs/` and push it.
2. Under **Sitemaps**, submit `https://verlass.alyssaagard.dev/sitemap.xml`.
3. Under **URL inspection**, enter `https://verlass.alyssaagard.dev/` and then `https://verlass.alyssaagard.dev/demo/`, and choose **Request indexing** for each.
4. Optionally, in [Bing Webmaster Tools](https://www.bing.com/webmasters), choose to import the site from Google Search Console.

Google shows the favicon in results only after it crawls the home page again, which can take from a few days to a few weeks. After a change of address, update `SITE_URL`, rebuild, and submit the new sitemap.

## Microsoft sign-in library

`docs/app/vendor/msal-browser.min.js` is Microsoft's MSAL.js for browsers, version 4.30.0 (the long-term support line), copied unchanged from the npm package `@azure/msal-browser` (`lib/msal-browser.min.js`). Its license is beside it. To update, download the same file from a newer 4.x release, replace it, and run the Outlook real-world tests. Version 5 changes how the library is used; read its migration guide first.

## A shared app registration (later)

Today each organization registers its own app in Microsoft Entra, which needs no account from the publisher. Once the company has a Microsoft tenant and a verified Microsoft partner account, one multitenant registration could serve every organization: administrators would then only grant consent, and the install page's form would need only the site address. The code already takes the application ID from the manifest, so this is a change to the install page and guide.

## Store listings (after the company developer accounts exist)

- **Microsoft AppSource**: needs a Microsoft Partner Center account for the company and the shared app registration above. Submit `docs/outlook/manifest.xml` with the privacy (`/privacy/`), terms (`/terms/`), and help (`/help/`) pages, and the icons in `docs/assets/icons/`.
- **Google Workspace Marketplace (public)**: needs a Google Cloud project owned by the company, an OAuth consent screen, the Marketplace SDK, and Google's review of the permissions. A public listing of the Standard project would ask every organization's staff for the spreadsheet permission, so think about listing the Private add-on with a hosted service, which changes the "no server" promise, before choosing this.

## Moving the project to the company

1. Create the company's GitHub organization, then in this repository open Settings, General, Transfer ownership. GitHub redirects the old repository address.
2. Set up GitHub Pages and the custom domain again in the new organization (the steps above). Keep `verlass.alyssaagard.dev`, or choose a company subdomain and follow "To use a different address".
3. Change `PROVIDER` in `scripts/site.config.mjs` to the company's legal name, and update the copyright line in `LICENSE` if the company now holds the copyright.
4. Keep `ADDIN_ID` the same: it identifies the add-in to Outlook.

## Brand assets

`npm install` then `npm run brand` regenerates every logo, icon, and favicon from `brand/fonts/CormorantGaramond-500-italic.woff` (the same typeface as Offizin and Cachet). Outputs go to `docs/assets/`, `docs/favicon.*`, and `docs/app/ui/mark.js`. For the GitHub social preview, upload `docs/assets/brand/verlass-social.png` under Settings, General, Social preview. Headings on the site use IBM Plex Mono, and text uses IBM Plex Sans; both are in `docs/assets/fonts/` under the SIL Open Font License.

## The old repository

Replace the README of `organization-it-helpdesk` with a short note that says the project is now Verlass and links to https://github.com/alyssaagard/verlass and https://verlass.alyssaagard.dev, and set that repository's website field to the new site. Archive it (Settings, General, Archive this repository) only after the note is in place and only when you are ready; an archived repository is read-only but stays visible, and it can be unarchived.
