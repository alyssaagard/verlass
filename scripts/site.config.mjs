/**
 * The one place to change the product's name, public address, version, and publisher.
 *
 * SITE_URL is where docs/ is published (GitHub Pages with a custom domain). The Outlook
 * manifest and the Gmail add-on's icon point at this address, so change it here and run
 * `npm run build`. Organizations that installed the Outlook add-in from an older manifest
 * need to install it again after the address changes, so pick the long-term address first.
 */
export const NAME = "Verlass";

/** Lowercase name used in file names and the subdomain. */
export const SLUG = "verlass";

export const TAGLINE = "The help desk that lives in your inbox.";

export const DESCRIPTION = "A free, open-source help desk for any organization. People send and follow requests from Gmail or Outlook, and the team works its queue in the same place. Your data stays in your own Google or Microsoft 365 account.";

export const SITE_URL = "https://verlass.alyssaagard.dev";

/** The Outlook add-in's permanent ID. Keep it the same for the life of the add-in. */
export const ADDIN_ID = "bb17164f-3928-4329-9458-1b70d3575dff";

export const VERSION = "2.0.1";

/** The release date of this version, used for the timestamps inside the download packages. */
export const RELEASE_DATE = "2026-11-13";

/** Shown as the publisher. Change to the company name after the transfer. */
export const PROVIDER = "Alyssa I. Agard";

export const REPO_URL = "https://github.com/alyssaagard/verlass";

/** The repository this project replaced. */
export const OLD_REPO_URL = "https://github.com/alyssaagard/organization-it-helpdesk";
