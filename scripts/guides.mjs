/**
 * The plain text guides that go inside the download packages. Plain text opens anywhere.
 * The install page on the website has the same steps with more explanation.
 */
import { NAME, SLUG, SITE_URL, VERSION, PROVIDER } from "./site.config.mjs";

const HOST = new URL(SITE_URL).host;

export function gmailReadme() {
  return `${NAME} ${VERSION} for Gmail: Standard install
A help desk in the Gmail side panel. By ${PROVIDER}.
${SITE_URL}

WHAT IS IN THIS PACKAGE

  Addon.gs          Opens ${NAME} in Gmail and connects it to the help desk.
  Cards.gs          The screens: new request, lists, and one ticket.
  SettingsCards.gs  The settings screens for administrators.
  Service.gs        The help desk itself: who may do what, and the email.
  Store.gs          Reads and writes the help desk's Google Sheet.
  Core.gs           The rules shared with ${NAME} for Outlook.
  appsscript.json   The project settings and the permissions it asks for.
  LICENSE.txt       The MIT License, which lets you use, change, and share
                    ${NAME}. Keep it with any copy you pass on.
  README.txt        This guide.

Everything runs in your own Google account. Tickets and settings are rows in
one Google Sheet in your Drive. ${NAME} has no server and no tracking.

In this Standard install, everyone who uses the help desk needs edit access to
that Sheet. That is fine for one person or a small team that trusts each
other. For an organization, use the Private install instead
(${SLUG}-gmail-private.zip), which keeps the Sheet closed.

Version ${VERSION} is new. It has been tested against a simulated Gmail and
Google Sheets, and has not yet been run in a live Google account. Try it with
a few people first.

INSTALL

  1. Go to script.google.com, select New project, and rename it ${NAME}.
  2. Select Project Settings (the gear) and check
     Show "appsscript.json" manifest file in editor.
  3. Back in the Editor, for each of Addon, Cards, Core, Service,
     SettingsCards, and Store: select the plus sign next to Files, choose
     Script, type the name, and replace everything in the new file with the
     contents of the matching .gs file from this package.
     Then delete the starter file Code.gs.
  4. Open appsscript.json and replace everything in it with this package's
     appsscript.json. If you are not in the US Eastern time zone, change
     America/New_York to yours, for example Europe/Berlin. Save.
  5. Select Deploy, then Test deployments, then Install, then Done.
  6. Open Gmail and reload it. Select the ${NAME} icon in the panel on the
     right, select Authorize access, and approve the permissions.
     With a free Gmail account, Google first says that it has not verified
     this app, because the project is your own. Select Advanced, then
     Go to ${NAME} (unsafe).
  7. Enter your organization's name, choose a starting set of lists, and
     select Create the help desk. You become the first administrator.
  8. Open Settings, then Team, and add the people who work on tickets.
     Select Open the spreadsheet and share the Sheet, as Editor, with everyone
     who will use the help desk.

OTHER PEOPLE

  A test deployment is installed per person, and Google lets a person install
  it only if they can edit the project. In Google Workspace they must also
  belong to the owner's organization. Anyone who can edit the project can
  change what it does, so share it only with people you would trust as
  administrators, and have each one do steps 5 and 6. Sharing between free
  Gmail accounts has not been tested.
  For everyone else, publish the add-on in the Google Workspace Marketplace
  for your organization only. The steps are at
  ${SITE_URL}/install/#gmail-organization

UPLOAD WITH CLASP (for IT teams and developers)

  1. Turn on the Apps Script API at script.google.com/home/usersettings.
  2. npm install -g @google/clasp   then   clasp login
  3. In an empty folder:
     clasp create-script --type standalone --title "${NAME}"
  4. Copy this package's files into the folder. Delete any Code.js file that
     clasp made, and let this package's appsscript.json replace clasp's.
  5. clasp push --force   then   clasp open-script
     and continue from step 5 above.
  Versions of clasp before 3 call these commands clasp create and clasp open.

CREATE A TICKET FROM THE OPEN EMAIL (optional)

  This needs one more permission, so it is off by default. The steps are at
  ${SITE_URL}/install/#gmail-email

UPDATES AND HELP

  Add-ons installed this way do not update themselves. When a new version
  comes out, replace the script files with the new package's files. Your
  Sheet and your settings are not touched. If you published the add-on for
  your organization, also select Deploy, then Manage deployments, edit the
  add-on deployment, and choose New version.
  Google limits the email an account sends through Apps Script to about 100
  recipients a day for a free account and 1,500 for a Google Workspace
  account.
  Help: ${SITE_URL}/help/
`;
}

export function gmailPrivateReadme() {
  return `${NAME} ${VERSION} for Gmail: Private install
A help desk in the Gmail side panel. By ${PROVIDER}.
${SITE_URL}

WHAT IS IN THIS PACKAGE

  service/   The help desk service: Core.gs, Service.gs, Store.gs, and
             appsscript.json. It owns the Google Sheet and sends the email.
             It runs as one account, ideally a shared one such as
             helpdesk@your-domain.
  addon/     The add-on people install: Addon.gs, Cards.gs, Core.gs,
             SettingsCards.gs, and appsscript.json. It asks staff only to
             run in Gmail, know their email address, and reach the service.
  LICENSE.txt The MIT License, which lets you use, change, and share
             ${NAME}. Keep it with any copy you pass on.
  README.txt This guide.

In this install the Google Sheet is shared with no one but its owner. The
add-on proves who each person is with a Google sign-in token, and the service
answers only for that person. Staff see only their own requests.

Version ${VERSION} is new. It has been tested against a simulated Gmail and
Google Sheets, and has not yet been run in a live Google account. Try it with
a few people first.

PART 1: THE SERVICE

  Sign in to Google as the account that should own the help desk.
  1. Go to script.google.com, select New project, and rename it
     ${NAME} service.
  2. Select Project Settings (the gear) and check
     Show "appsscript.json" manifest file in editor.
  3. In the Editor, add the script files Core, Service, and Store (the plus
     sign next to Files, then Script) and paste in the matching .gs files from
     the service folder. Delete the starter file Code.gs. Replace everything
     in appsscript.json with the one in the service folder, and change
     America/New_York to your time zone if needed. Save.
  4. Select Deploy, then New deployment. Choose the type Web app. Set
     Execute as to Me and Who has access to Anyone. Select Deploy and approve
     the permissions. With a free Gmail account, Google first says that it
     has not verified this app, because the project is your own. Select
     Advanced, then Go to ${NAME} service (unsafe).
  5. Copy the Web app URL. It ends in /exec.
  6. Recommended for Google Workspace: in Project Settings, under Script
     properties, add a property named ALLOWED_DOMAIN with your organization's
     primary domain, for example example.org. That is the domain shown first
     in the Google Admin console under Account, Domains, even when people use
     addresses at another of its domains. Separate several with commas. The
     service then refuses accounts from anywhere else. Do not set it for free
     Gmail accounts, which have no organization domain.

PART 2: THE ADD-ON

  1. Create a second project and rename it ${NAME}. Show the manifest file as
     before.
  2. Add the script files Addon, Cards, Core, and SettingsCards and paste in
     the matching .gs files from the addon folder. Delete Code.gs. Replace
     appsscript.json with the one in the addon folder. Save.
  3. In Project Settings, under Script properties, add a property named
     SERVICE_URL and paste the web app URL from Part 1.
  4. Select Deploy, then Test deployments, then Install, then Done.
  5. Open Gmail as the owner account, open ${NAME}, authorize it, and select
     Create the help desk. The first time the owner or an administrator opens
     the add-on, the service remembers this add-on project and refuses
     requests from any other.
  6. Open Settings, then Team, and add your team.

WHY THE WEB APP IS OPEN TO "ANYONE"

  The add-on reaches the service over the internet, so Google must let the
  request in. The service then checks every request itself: it must carry a
  Google sign-in token for a verified account, from your domain if you set
  ALLOWED_DOMAIN, issued to your own add-on project. A request without those
  gets an error and nothing else. If your organization does not allow web
  apps that are open to anyone, use the Standard install.

OTHER PEOPLE

  For a few trusted people, share the add-on project (never the service
  project) with them as Editor and have each one do step 4 of Part 2, then
  open ${NAME} in Gmail and authorize it.
  Anyone who can edit the add-on project can change its code and could act as
  another person, so do not share it with ordinary staff. For them, publish
  the add-on project in the Google Workspace Marketplace for your
  organization only. The steps are at
  ${SITE_URL}/install/#gmail-organization
  Publish before people start using the help desk. Moving the add-on project
  to a Google Cloud project is expected to change the identity the service
  remembers. If people then see "made for a different add-on", delete the
  script property ALLOWED_AUDIENCE in the service project and have the owner
  open the add-on first.

UPDATES AND HELP

  When a new version comes out, replace the script files in both projects.
  In the service project, select Deploy, then Manage deployments, edit the
  web app, and choose New version, so its address stays the same. If you
  published the add-on for your organization, edit its add-on deployment the
  same way.
  Every email notice comes from the owner's account. Google limits it to
  about 100 recipients a day for a free account and 1,500 for a Google
  Workspace account.
  Only the time zone in the service project's appsscript.json matters; the
  add-on shows times the way the service does.
  Help: ${SITE_URL}/help/
`;
}

export function outlookReadme() {
  return `${NAME} ${VERSION} for Outlook
A help desk in the Outlook side panel. By ${PROVIDER}.
${SITE_URL}

WHAT IS IN THIS PACKAGE

  ${SLUG}-manifest.xml  The add-in manifest. It tells Outlook where ${NAME}
                        lives and what it may do. It holds no program code.
                        This copy has no connection settings yet (see below).
  LICENSE.txt           The MIT License, which lets you use, change, and share
                        ${NAME}. Keep it with any copy you pass on.
  README.txt            This guide.

${NAME} for Outlook works in Outlook on the web, the new and classic Outlook
for Windows, Outlook for Mac, and Outlook for iOS and Android, with Microsoft
365 work or school accounts. Tickets are items in a SharePoint list in your
own tenant. ${NAME} has no server and no tracking.

Version ${VERSION} is new. The Outlook add-in has been tested against a
simulated Microsoft 365, not yet in a live tenant. Try it with a few people
first.

THE EASY WAY

  Follow the steps at ${SITE_URL}/install/#outlook
  That page makes a manifest with your organization's settings already in it.

BY HAND

  An administrator does this once. A Global Administrator can do every step;
  the install page lists narrower roles. Whoever creates the lists must be an
  Owner of the help desk site.
  1. Create a private SharePoint team site for the help desk. Make the help
     desk team Owners of the site. Under the gear, Site permissions, Advanced
     permissions settings, open the Visitors group and add
     "Everyone except external users". Do not add staff as Members.
  2. In the Microsoft Entra admin center, under App registrations, select
     New registration. Name it ${NAME}, keep "Accounts in this organizational
     directory only", and add these three redirect URIs, all of the type
     Single-page application (SPA):
       brk-multihub://${HOST}
       ${SITE_URL}/app/blank.html
       ${SITE_URL}/app/auth.html
  3. Under API permissions, add the Microsoft Graph delegated permissions
     Sites.Selected and Mail.Send (User.Read is already there), then select
     Grant admin consent.
  4. Open ${SLUG}-manifest.xml in a text editor. Find every place that says
       ${SITE_URL}/app/outlook.html
     (there are three) and add your settings to the end of each, on one
     line, like this:
       ${SITE_URL}/app/outlook.html?client=APPLICATION-ID&amp;tenant=TENANT-ID&amp;site=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2Fhelpdesk
     Keep the &amp; between the parts, and write the site address with %3A
     for each colon and %2F for each slash.
  5. Open ${SITE_URL}/app/
     in a browser, enter the same three values, and sign in. Open
     "I am the administrator" and select "1. Create the lists". Microsoft
     asks you to approve one higher permission, Sites.FullControl.All. Leave
     "Consent on behalf of your organization" unchecked. Then enter your
     organization's name and select "2. Create the help desk".
     Afterward remove that permission again. The Entra admin center cannot
     remove one person's consent, so use Graph Explorer as the install page
     describes: ${SITE_URL}/install/#outlook-revoke
  6. Set who can see what. On the site, under Site contents:
     Help Desk Tickets: in List settings, Advanced settings, Item-level
       Permissions, choose "Read items that were created by the user" and
       "Create items and edit items that were created by the user". In
       Permissions for this list, stop inheriting permissions and grant
       "Everyone except external users" the level Contribute.
     Help Desk Notes: in Permissions for this list, stop inheriting
       permissions and remove every group except the Owners.
     Help Desk Settings: leave it as it is.
  7. In the Microsoft 365 admin center, go to Settings, then Integrated apps.
     Select Upload custom apps, choose Office Add-in as the app type, upload
     the manifest, choose who gets it, and finish the deployment. It can take
     up to 24 hours to appear, sometimes longer.
  8. Open ${NAME} in Outlook, open the menu, choose Settings, then Lists, then
     Team, and add the people who work on tickets.

FOR ONE PERSON, OR TO TEST FIRST

  In Outlook on the web, open https://aka.ms/olksideload, choose My add-ins,
  then Add a custom add-in, then Add from File, and choose the manifest.

UPDATES AND HELP

  Outlook loads ${NAME} from its website each time it opens, so there is
  nothing to reinstall when a new version comes out.
  Help: ${SITE_URL}/help/
`;
}
