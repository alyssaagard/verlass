<p align="center">
  <img src="docs/assets/brand/verlass-logo-solid.png" alt="Verlass" width="240">
</p>

<p align="center"><strong>The help desk that lives in your inbox.</strong><br>
A free, open-source help desk for Gmail and Outlook, for any organization.</p>

<p align="center">
  <a href="https://verlass.alyssaagard.dev">Website</a> &nbsp;|&nbsp;
  <a href="https://verlass.alyssaagard.dev/demo/">Try it in your browser</a> &nbsp;|&nbsp;
  <a href="https://verlass.alyssaagard.dev/install/#gmail">Install for Gmail</a> &nbsp;|&nbsp;
  <a href="https://verlass.alyssaagard.dev/install/#outlook">Install for Outlook</a>
</p>

---

Verlass turns the side panel of your email into a help desk. People send a request and follow it without leaving their inbox. The team sees its queues, assigns work, replies, and keeps notes in the same place. It suits an office of five, a school, a nonprofit, or a company with many sites, and it is free for personal, commercial, school, and enterprise use.

Your data stays yours. Tickets live in a Google Sheet in your own Google account, or in a SharePoint list in your own Microsoft 365. Verlass has no server, no account to create, and no tracking.

*Verlass* is the German word for dependability. "Auf uns ist Verlass" means "you can count on us."

## What it does

| | |
|---|---|
| Requests from the inbox | A request has a subject, category, priority, location, and description. The requester gets a ticket number, a confirmation, and email updates, and can reply to, close, and reopen their own requests. |
| Queues for the team | The team works from queues for open, unassigned, assigned to me, overdue, waiting, finished, and all tickets, each in work order. It can search by number, name, or words, and filter by category, priority, and person. |
| Assignment | Rules assign tickets by category, priority, location, or keyword. A category can have a default person, and round robin can take everything else. People marked inactive are skipped. |
| Due times | Each priority allows a number of hours, counted in your working days and hours with your days off skipped. Overdue tickets rise to the top. |
| Conversation | A ticket holds replies to and from the requester, internal notes that only the team can read, and an activity log of every change. |
| Email | There are seven notices with wording you can change, placeholders for the ticket's details, and switches to turn them off. |
| Customization without code | Categories, priorities, statuses, locations, the team, rules, working hours, the word for a ticket, the number format, colors, and logo are all settings. Renaming an item renames it on its tickets. Four starting presets: office, school, nonprofit, and facilities. |
| A ticket from an email | The team can turn the message it is reading into a ticket in its sender's name. |
| Careful with what people type | Text typed by people is escaped wherever it is shown, is stored as plain text and not as a spreadsheet formula, and is kept to one line in email subjects. When two people change one ticket, the second is asked to look again. Creating a ticket holds a lock, so numbers do not repeat. |

Try all of it, with no install and no sign-in, at **[verlass.alyssaagard.dev/demo](https://verlass.alyssaagard.dev/demo/)**.

## Install

**Gmail and Google Workspace.** A Google Workspace add-on in Apps Script, in two forms. The *Standard* install is one project and suits one person or a small team. The *Private* install adds a small service that owns the Google Sheet, so the Sheet is shared with no one and staff are asked for no spreadsheet or mail permission. Organizations can publish either as a private Marketplace app. Steps: [verlass.alyssaagard.dev/install/#gmail](https://verlass.alyssaagard.dev/install/#gmail).

**Outlook and Microsoft 365.** An Office add-in for Outlook on the web, Windows, Mac, iOS, and Android, deployed from the Microsoft 365 admin center. Tickets are items in a SharePoint list in your own tenant, and the install guide sets SharePoint's own permissions so that each person gets only their own requests. The add-in reads only the open message, and Microsoft Graph access can be limited to the one help desk site. Steps, and a form that makes your manifest: [verlass.alyssaagard.dev/install/#outlook](https://verlass.alyssaagard.dev/install/#outlook).

**Packages.** [verlass-gmail.zip](https://verlass.alyssaagard.dev/download/verlass-gmail.zip), [verlass-gmail-private.zip](https://verlass.alyssaagard.dev/download/verlass-gmail-private.zip), and [verlass-outlook.zip](https://verlass.alyssaagard.dev/download/verlass-outlook.zip) hold the install files with a plain text guide, for sharing or for an IT team.

## Status

Version 2.0 is a complete rebuild. Its rules, the Gmail add-on, and the Microsoft 365 backend are covered by automated tests that run the real code against simulated Google and Microsoft services, and the screens are driven in headless Chrome. It has not yet been run in a live Gmail account or a live Microsoft 365 tenant; [MAINTAINING.md](MAINTAINING.md) lists exactly what to try. Please [report what you find](https://github.com/alyssaagard/verlass/issues). Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## Privacy

Verlass's publisher receives nothing from you. Tickets are stored in your own Google Sheet or SharePoint lists, and email is sent from your own account. See the [privacy policy](https://verlass.alyssaagard.dev/privacy/).

## How it is built

One set of rules, three places to run:

```
docs/app/core  (tickets, settings, assignment, due times, email wording)
      |
      |-- bundled into gmail/Core.gs --> Gmail add-on (Apps Script cards, Google Sheet)
      |
      '-- used as modules by docs/app/ui --> Outlook task pane and browser app (SharePoint lists through Microsoft Graph)
                                         --> the live demo (sample data in the browser)
```

```
verlass/
  docs/                       The website, published by GitHub Pages
    app/core/                 The shared rules (plain JavaScript modules)
    app/ui/                   The screens used by Outlook, the browser app, and the demo
    app/stores/               The service, the demo data, and the Microsoft 365 backend
    app/hosts/                Microsoft 365 sign-in, connection settings, and setup
    app/outlook/              The Outlook manifest builder
    app/vendor/               Microsoft's MSAL.js sign-in library (MIT License)
    download/                 Built install packages
    demo/, install/, help/, privacy/, terms/   Built pages
  gmail/                      Apps Script source. Core.gs and appsscript.json are built.
  brand/                      Logo generator and the logo font (SIL Open Font License)
  scripts/                    Build, checks, pages, guides, local server, and site settings
    tests/                    One test file per area
    lib/                      The Apps Script simulator, the bundler, and the zip writer
```

The browser code is plain JavaScript modules with no frameworks. The only third-party code is Microsoft's: its sign-in library, served from this site, and its Office script, which the Outlook pages load from Microsoft.

## Development

You need Node.js 22 or later.

```bash
npm run build    # writes Core.gs, the website pages, the Outlook manifest, and the packages
npm run check    # house style, generated files, and every test area
npm run check -- --only=gmail   # one area: core, gmail, web, pages, colors, packages, or ui
npm run serve    # serves the website at http://localhost:8080
npm install && npm run brand   # only to regenerate the logo and icons
```

The name, address, version, and publisher are in `scripts/site.config.mjs`. To change a rule (how tickets are assigned, when they are due, what an email says), edit `docs/app/core` and run the build; Gmail, Outlook, and the demo all pick it up. Run `npm run build` and `npm run check` before committing; the GitHub workflow runs the same checks.

Maintainer notes (publishing, the custom domain, real-world testing, store listings, and moving the project to a company account) are in [MAINTAINING.md](MAINTAINING.md).

## History

Verlass 2.0 replaces [organization-it-helpdesk](https://github.com/alyssaagard/organization-it-helpdesk), a Gmail add-on first written for a school. That repository is kept for reference.

## License

[MIT](LICENSE). Copyright 2026 Alyssa I. Agard.

Verlass is not affiliated with Google or Microsoft. Gmail, Google Workspace, and Google Sheets are trademarks of Google LLC; Outlook, Microsoft 365, and SharePoint are trademarks of the Microsoft group of companies.
