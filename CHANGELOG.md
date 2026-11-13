# Changelog

## 2.0.0 (2026-11-13)

Verlass is the new name and a complete rebuild of the School IT Help Desk add-on (the `organization-it-helpdesk` repository). It is now for any organization, on Gmail and on Outlook.

New

- A Microsoft Outlook add-in for the web, Windows, Mac, iOS, and Android. Tickets are items in a SharePoint list in the organization's own Microsoft 365, reached through Microsoft Graph with no server. The same help desk also opens in a browser tab.
- A live demo at `/demo/` with sample tickets, three people to act as, and an outbox that shows every email the help desk would send.
- Everything is a setting, changed from the add-on with no code: categories, priorities with the hours each allows, statuses with a kind (open, waiting, or done), locations, the team and its administrators, assignment rules, working days and hours, days off, the word for a ticket, the number format, colors, logo, and the wording of each email. Four presets to start from: office, school, nonprofit, and facilities.
- Assignment rules by category, priority, location, or keyword, a default person per category, and round robin.
- Due times that count only working hours, an Overdue queue, and work-order sorting.
- A conversation on each ticket: replies to the requester, replies from the requester, and internal notes that only the team can read.
- Requesters can close their own tickets and reopen them with a reply.
- Search, filters by category, priority, and person, and paging in every list.
- Renaming a status, priority, category, or location renames it on the tickets and rules that use it. Settings that could not be used as typed are corrected and named.
- Create a ticket from the open email, in its sender's name (in Gmail this is an optional permission).
- A Private install for Gmail: a small service owns the Google Sheet, so the Sheet is shared with no one, and staff are asked for no spreadsheet or mail permission.
- Dark, Light, and System themes, with dark as the default.

Fixed from the old add-on

- Ticket numbers could repeat when two people sent a request at once, when the sheet was sorted, or after ticket 9999. Creating a ticket now holds a lock, the next number is one more than the highest in the sheet, and numbers grow past four digits.
- An assignment or a note could never be cleared, because an empty box kept the old value.
- The email to a newly assigned team member was written but never sent.
- "IT Notes" were shown and emailed to the requester. Internal notes are now separate from replies and stay with the team.
- Every staff member needed edit access to the whole spreadsheet. The Private install removes that, and the Standard install's guide says so plainly.
- Text typed into a ticket went into HTML email unescaped and could be stored in the Sheet as a formula. It is now escaped everywhere, written as plain text, and kept to one line in email subjects.
- A team address with capital letters in the configuration never matched. Addresses are compared without regard to capitals.
- Queues and counts used fixed status and priority names, so renaming one broke them. They now use each status's kind and each priority's position.
- Three permissions were requested and never used (reading the current message, outside requests, and locale). The Standard install now asks for four permissions and the Private add-on for four narrower ones.
- Dates were written as text that Sheets turned into dates and that then showed in a long raw form. Times are stored exactly and shown in the help desk's time zone, which is now a setting.
- Lists stopped at 25 tickets. Every list is paged.
- Two people saving the same ticket could silently overwrite each other. The second is now asked to open the ticket again.

Not yet tested in a live account

- The automated tests run the real code against simulated Google and Microsoft services and drive the screens in headless Chrome. Verlass has not yet been run in a live Gmail account or a live Microsoft 365 tenant. See "Real-world tests" in MAINTAINING.md.
