# Event ticketing — static edition

QR tickets that run entirely in the browser. No server, no database, no hosting
bill. Deploys to GitHub Pages (or Netlify, Cloudflare Pages, any static host).

If you want tickets to be **emailed automatically** the moment you confirm a
payment, use the server edition in `../webhost/` on cheap PHP hosting. That one
does the whole loop by itself. This one needs you to press a button.

## The four pages

| Page | Who opens it |
|---|---|
| `index.html` | **Attendees.** Event details and the sign-up form. |
| `admin.html` | **You.** Event setup, attendee list, issuing tickets. |
| `ticket.html` | **Attendees.** Their ticket with the QR code. |
| `scan.html` | **Door staff.** The camera scanner. |

## Deploy in 3 minutes

1. Create a GitHub repository and upload the contents of this folder.
2. **Settings → Pages → Source: Deploy from a branch**, pick `main` and `/ (root)`.
3. Open `https://yourname.github.io/yourrepo/`.

HTTPS comes free, which matters: phone cameras refuse to open on an insecure
page, so the scanner needs it.

## How a ticket actually happens

**1. Set up your event** — open `admin.html`, fill in the details, save.

**2. Share your sign-up link** — the console gives you a link that carries the
event details. Post it, message it, put it on a poster as a QR code.

*Optional:* press **Download event.json**, commit that file next to
`index.html`, and your plain site address works as the sign-up page — no long
link needed.

**3. They register themselves.** An attendee opens the link, fills in name,
email, phone and quantity, and gets:

- a **payment reference** like `K7P-4RM2` to put in the payment note
- your **payment button** (PayPal.me, Wise, bank link — whatever you set)
- a **registration code** to send you, by email or WhatsApp or SMS

**4. You add them.** Under *Attendees* → *"Someone sent me a registration
code"*, paste what they sent. Their details fill in exactly as they typed them,
so nothing gets mistyped. A code buried in a forwarded email is found fine.

**5. You confirm payment.** Match the reference in your PayPal or bank
activity, tick **paid**, and the ticket is issued immediately.

**6. You send the ticket** — *Copy link*, *Email* (opens your mail app with the
message written), or download the QR image to send as a picture.

**7. At the door** — open `scan.html` on the scanning phone, paste the signing
key once, and scan. Green admits, amber is already-used, red is a forgery.

## What you must know before relying on this

**Everything lives in your browser.** No account, no server copy. Use
**Backup** before the event and keep the file. Clearing browser data would
otherwise lose the whole event.

**Duplicate detection is per-device.** The scanning phone remembers who it let
in; a second phone knows nothing about the first. **Use one scanning device per
door**, or accept that a ticket could be used at two doors.

**Never publish your signing key.** Don't commit it, don't paste it anywhere
public. Anyone with it can mint valid tickets. It belongs only in your console
and on your scanning phones. The sign-up link never contains it — that is
checked by the test suite.

**Don't change the key after sending tickets.** Every ticket already issued
stops working. The console warns you.

**Hand-typed codes cannot be verified.** Only the QR carries a signature. The
manual box will tell you whether a code has already been scanned on that
device, but it cannot prove the ticket is genuine — check the name against
your list.

## Why it is safe to host publicly

The site contains no secrets. Your event, attendee list and signing key live in
*your* browser's local storage and are never uploaded.

Ticket links and sign-up links carry their data in the URL **fragment** (after
`#`), which browsers never send to a server — so even GitHub never sees who
your attendees are. A ticket link contains a pre-signed QR string but not the
key, so holding a ticket does not let anyone forge another.

Anyone can open your console URL, but they get an empty console of their own.

## Compared with the server edition

| | Static (free) | Server (`../webhost/`, ~$2–3/mo) |
|---|---|---|
| Attendees self-register | ✓ | ✓ |
| Payment link | ✓ | ✓ |
| Getting their details | They send you a code | Straight into your dashboard |
| Issuing the ticket | You press a button | Automatic on confirming payment |
| Ticket delivery | You send the link | Emailed automatically |
| Duplicate detection | One device | Every device, shared |
| Live dashboard | Your browser only | Shared and live |

The static edition suits a small event with one door and one organiser. Past
roughly a hundred attendees, or with a second person on the door, the server
edition will save you real work.

## Files

```
index.html      public sign-up page
admin.html      organiser console
ticket.html     what an attendee opens
scan.html       door scanner
assets/qr.js    QR encoder, vendored so the door works with no signal
assets/jsQR.js  QR decoder for the camera
event.json      optional — commit it for a clean site address
.nojekyll       tells GitHub Pages to serve the files as-is
```
