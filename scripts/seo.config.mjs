/**
 * What search engines and link previews show for each public page of the website.
 *
 * `npm run build` writes these into every public page between the "seo:start" and "seo:end"
 * comments in its head, and writes docs/sitemap.xml, docs/robots.txt, and docs/site.webmanifest.
 * Edit the text here, never in the built pages.
 *
 * Keep each title under about 60 characters and each description between 70 and 160, since
 * search results cut longer ones off. Write descriptions as plain sentences that say what the
 * page is for, using the words people search with. Search engines ignore keyword lists, so
 * there is no keywords tag.
 *
 * Copyright (c) 2026 Alyssa I. Agard. MIT License; see LICENSE.
 */

/** The name search results show for the whole site. */
export const SITE_NAME = "Verlass";

/** The picture link previews show (1280 by 640 pixels), and its description for screen readers. */
export const SOCIAL_IMAGE = { path: "assets/brand/verlass-social.png", width: 1280, height: 640, alt: "Verlass: a free IT help desk for Gmail and Outlook" };

/** Browser and search colors for the dark theme (the default) and the light theme. */
export const THEME_COLORS = { dark: "#141C18", light: "#F1F4F2" };

/**
 * Public pages, in sitemap order. `path` is the address under the site ("" is the home page)
 * and `file` is the page inside docs/. `schema` adds structured data: "site" describes the
 * website, its author, and the software, and "demo" describes the live demo as a web
 * application. Every other HTML page is kept out of search results with a noindex tag.
 */
export const SEO_PAGES = [
  {
    path: "",
    file: "index.html",
    title: "Verlass | Free IT help desk for Gmail and Outlook",
    description: "A free, open-source IT help desk and ticketing system for Gmail and Outlook, for small businesses, schools, and nonprofits. Your data stays in your account.",
    schema: "site",
    priority: "1.0",
  },
  {
    path: "demo/",
    file: "demo/index.html",
    title: "Verlass live demo | Try the help desk in your browser",
    description: "Try the free Verlass help desk in your browser with sample tickets and no sign-in. Send a request, work the team's queues, and change every setting.",
    schema: "demo",
    priority: "0.9",
  },
  {
    path: "install/",
    file: "install/index.html",
    title: "Install Verlass | Gmail add-on and Outlook add-in",
    description: "Install the free Verlass help desk as a Gmail add-on or an Outlook add-in, for one person, a small business, a school, or a whole organization.",
    priority: "0.8",
  },
  {
    path: "help/",
    file: "help/index.html",
    title: "Verlass help | Requests, queues, and settings",
    description: "How to send and follow requests in Verlass, work the team's queues, and set categories, priorities, statuses, assignment rules, due times, and email.",
    priority: "0.6",
  },
  {
    path: "privacy/",
    file: "privacy/index.html",
    title: "Verlass | Privacy policy",
    description: "Verlass has no server, and its publisher receives no data. This policy explains how tickets stay in your own Google Sheet or Microsoft 365.",
    priority: "0.3",
  },
  {
    path: "terms/",
    file: "terms/index.html",
    title: "Verlass | Terms of use",
    description: "The terms for using Verlass, a free and open-source help desk add-in for Gmail and Outlook, released under the MIT License.",
    priority: "0.3",
  },
];
