# Event ticketing — static edition

QR tickets that run entirely in the browser. No server, no database, no
hosting bill. Deploys to GitHub Pages (or Netlify, Cloudflare Pages, or any
static host) for free.

This is the **cut-down** edition. If you want automatic ticket emails, a shared
live dashboard, and duplicate detection across several phones, use the server
edition in `../webhost/` on cheap PHP hosting instead.

## Deploy in 3 minutes

1. Create a GitHub repository and upload the contents of this folder.
2. **Settings → Pages → Source: Deploy from a branch**, pick `main` and `/ (root)`.
3. Open `https://yourname.github.io/yourrepo/`.

HTTPS comes free and automatic, which matters: phone cameras refuse to open on
an insecure page, so the scanner needs it.

## How to run an event

**1. Set up (organiser console — the site's front page)**

Fill in your event details and press save. A **signing key** is generated for
you. That key is what makes tickets impossible to forge.

**2. Add attendees**

Add each person as they register and pay you. Tick **paid** and the ticket is
issued immediately — that's the same "confirm payment, then send the ticket"
flow as the server edition, just done by hand.

**3. Send the tickets**

Each issued ticket gives you:

- **Copy link** — paste into WhatsApp, Messenger, SMS, anywhere
- **Email** — opens your mail app with the message already written
- **QR** — preview and download the image to send as a picture

**4. At the door**

Open `scan.html` on the scanning phone, paste the signing key once, and scan.
Valid tickets go green, already-used ones go amber, forgeries go red.

## What you must know before relying on this

**Everything lives in your browser.** There is no account and no server copy.
Use **Backup** before the event and keep the file. Clearing your browser data
would otherwise lose the whole event.

**Duplicate detection is per-device.** The scanning phone remembers who it has
let in. A second phone knows nothing about the first. **Use one scanning device
per door**, or accept that the same ticket could be used at two doors.

**Never publish your signing key.** Don't commit it, don't put it in the repo,
don't paste it anywhere public. Anyone with it can mint valid tickets. It only
ever belongs in the organiser console and on your scanning phones.

**Don't change the key after sending tickets.** Every ticket already issued
stops working. The console warns you about this.

**Hand-typed codes cannot be verified.** Only the QR carries a signature. If
someone's screen is broken, the manual box will tell you whether that code has
already been scanned on this device, but it cannot prove the ticket is genuine —
check the name against your list.

## Why it is safe to host publicly

The site itself contains no secrets. Your event, your attendee list and your
signing key are in *your* browser's local storage, never uploaded.

Ticket links carry their data in the URL **fragment** (after the `#`), which
browsers never send to a server — so even the page host never sees who your
attendees are. A ticket link contains a pre-signed QR string but not the key,
so holding a ticket does not let anyone forge another.

Anyone can open your organiser console URL, but they will see an empty console
of their own. None of your data is there.

## Files

```
index.html     organiser console (the front page)
ticket.html    what an attendee opens
scan.html      door scanner
assets/qr.js   QR encoder, vendored so the door works with no signal
assets/jsQR.js QR decoder for the camera
.nojekyll      tells GitHub Pages to serve the files as-is
```

## Compared with the server edition

| | Static | Server (`../webhost/`) |
|---|---|---|
| Hosting cost | Free | ~$2–3/month |
| Attendees self-register | ✗ you add them | ✓ public form |
| Ticket emails | ✗ manual send | ✓ automatic |
| Duplicate detection | One device | All devices |
| Live dashboard | Your browser only | Shared, live |
| Data safety | Your browser + backups | Server database |

The static edition suits a small event with one door and one organiser. Past
roughly a hundred attendees, or with more than one person at the door, the
server edition will save you real trouble.
