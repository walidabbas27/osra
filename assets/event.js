/**
 * Public event page and sign-up form.
 *
 * With no server there is nothing to POST to, so registration works by handing
 * the attendee a short code that carries their details. They send it to the
 * organiser however they like - email, WhatsApp, SMS - and the organiser pastes
 * it into the console, which adds them with no retyping and no typos.
 */
(function () {
  'use strict';

  var esc = App.escapeHtml;
  var root = document.getElementById('root');
  var STORE_KEY = 'ticketing.myregistration';

  function card(title, message, extra) {
    return '<div class="card card--center">'
      + '<div class="glyph">&#127903;</div>'
      + '<h1>' + esc(title) + '</h1>'
      + '<p class="muted">' + esc(message) + '</p>'
      + (extra || '')
      + '</div>';
  }

  // ------------------------------------------------------- load the event

  function loadEvent() {
    var hash = location.hash.replace(/^#/, '');
    if (hash) {
      try {
        return Promise.resolve(App.decodeJson(hash));
      } catch (e) {
        return Promise.resolve(null);
      }
    }
    // No link data: fall back to an event.json committed next to this page.
    return fetch('event.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  loadEvent().then(render).catch(function (err) {
    root.innerHTML = card('Something went wrong', err.message);
  });

  // ------------------------------------------------------------- render

  function render(ev) {
    if (!ev || !ev.name) {
      root.innerHTML = card(
        'No event published yet',
        'This link is missing its event details. Ask the organiser for the full sign-up link.',
        '<p><a class="btn btn--ghost" href="admin.html">Organiser console</a></p>'
      );
      return;
    }

    document.title = ev.name;

    var price = Number(ev.price) || 0;
    var when = [ev.startsAt, ev.doorsAt ? 'Doors ' + ev.doorsAt : ''].filter(Boolean).join(' · ');
    var where = [ev.venue, ev.address].filter(Boolean).join(', ');

    var fact = function (label, value) {
      return value ? '<div class="fact"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>' : '';
    };

    var maxQty = Math.max(1, parseInt(ev.maxPerPerson, 10) || 1);
    var qtyField = '';
    if (maxQty > 1) {
      var opts = '';
      for (var i = 1; i <= maxQty; i++) opts += '<option value="' + i + '">' + i + '</option>';
      qtyField = '<label class="field"><span class="field__label">How many tickets?</span>'
        + '<select name="quantity">' + opts + '</select></label>';
    }

    root.innerHTML = ''
      + '<header class="hero">'
      +   (ev.brand ? '<div class="hero__brand">' + esc(ev.brand) + '</div>' : '')
      +   '<h1>' + esc(ev.name) + '</h1>'
      +   (ev.tagline ? '<p class="hero__tagline">' + esc(ev.tagline) + '</p>' : '')
      + '</header>'

      + '<div class="card">'
      +   '<dl class="facts">'
      +     fact('When', when)
      +     fact('Where', ev.venue)
      +     fact('Address', ev.address)
      +     '<div class="fact"><dt>Price</dt><dd>'
      +       (price > 0 ? esc(App.money(price, ev.currency)) + ' <span class="muted">per ticket</span>' : 'Free')
      +     '</dd></div>'
      +   '</dl>'
      +   (ev.description ? '<div class="prose"><p>' + esc(ev.description).replace(/\n/g, '<br>') + '</p></div>' : '')
      + '</div>'

      + '<div class="card" id="signupCard">'
      +   '<h2>Register</h2>'
      +   '<div id="formErrors"></div>'
      +   '<form id="signupForm" class="form" autocomplete="on">'
      +     '<label class="field"><span class="field__label">Full name</span>'
      +       '<input name="full_name" required maxlength="120" autocomplete="name" placeholder="Jane Doe"></label>'
      +     '<label class="field"><span class="field__label">Email address</span>'
      +       '<input name="email" type="email" required maxlength="180" autocomplete="email" inputmode="email" placeholder="jane@example.com">'
      +       '<span class="field__hint">Your ticket is sent here.</span></label>'
      +     '<label class="field"><span class="field__label">Phone number</span>'
      +       '<input name="phone" type="tel" required maxlength="40" autocomplete="tel" inputmode="tel" placeholder="+1 555 010 0000"></label>'
      +     qtyField
      +     '<button class="btn btn--primary btn--block" type="submit">Continue &rarr;</button>'
      +     '<p class="fineprint">No account needed. The next step shows how to pay and confirm your place.</p>'
      +   '</form>'
      + '</div>';

    document.getElementById('signupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      submit(ev, e.target);
    });

    // Coming back to the page shows the reference again rather than losing it.
    var saved = App.load(STORE_KEY, null);
    if (saved && saved.eventName === ev.name) showNextStep(ev, saved);
  }

  // ------------------------------------------------------------- submit

  function submit(ev, form) {
    var values = {
      name: form.elements.full_name.value.trim().replace(/\s+/g, ' '),
      email: form.elements.email.value.trim().toLowerCase(),
      phone: form.elements.phone.value.trim(),
      quantity: form.elements.quantity ? parseInt(form.elements.quantity.value, 10) || 1 : 1
    };

    var errors = [];
    if (values.name.length < 2) errors.push('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) errors.push('Enter a valid email address.');
    if (values.phone.replace(/\D/g, '').length < 6) errors.push('Enter a valid phone number.');

    var box = document.getElementById('formErrors');
    if (errors.length) {
      box.innerHTML = '<div class="notice notice--error"><strong>Please fix the following:</strong><ul>'
        + errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
      return;
    }
    box.innerHTML = '';

    var registration = {
      name: values.name, email: values.email, phone: values.phone,
      quantity: values.quantity, ref: App.newRef(),
      eventName: ev.name, at: new Date().toISOString()
    };
    App.save(STORE_KEY, registration);
    showNextStep(ev, registration);
  }

  /** The registration code the organiser pastes into their console. */
  function buildCode(r) {
    return 'REG1:' + App.encodeJson({
      n: r.name, e: r.email, p: r.phone, q: r.quantity, r: r.ref
    });
  }

  function showNextStep(ev, r) {
    var price = Number(ev.price) || 0;
    var amount = price * r.quantity;
    var code = buildCode(r);

    var payBlock = price > 0
      ? (ev.paymentLink
          ? '<a class="btn btn--primary btn--block btn--pay" href="' + esc(ev.paymentLink)
              + '" target="_blank" rel="noopener noreferrer">'
              + esc(ev.paymentLabel || 'Pay now') + ' &middot; ' + esc(App.money(amount, ev.currency)) + '</a>'
          : '<div class="notice notice--warn"><strong>Ask the organiser how to pay.</strong>'
              + '<span>No payment link was set for this event.</span></div>')
      : '<div class="notice notice--ok"><strong>Nothing to pay.</strong>'
          + '<span>This event is free. Just send your registration below.</span></div>';

    var subject = 'Registration for ' + ev.name;
    var body = [
      'I would like to register for ' + ev.name + '.',
      '',
      'Name:      ' + r.name,
      'Email:     ' + r.email,
      'Phone:     ' + r.phone,
      'Tickets:   ' + r.quantity,
      'Reference: ' + r.ref,
      '',
      'Registration code (paste this into your organiser console):',
      code
    ].join('\n');

    var mailHref = 'mailto:' + encodeURIComponent(ev.organiserEmail || '')
      + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);

    document.getElementById('signupCard').outerHTML = ''
      + '<div class="card">'
      +   '<h2>Almost there, ' + esc(r.name.split(' ')[0]) + '</h2>'

      +   '<div class="refbox">'
      +     '<span class="refbox__label">Your reference &mdash; put this in the payment note</span>'
      +     '<strong class="refbox__code">' + esc(r.ref) + '</strong>'
      +     '<button class="btn btn--ghost btn--small" type="button" id="copyRef">Copy</button>'
      +   '</div>'

      +   '<dl class="facts">'
      +     '<div class="fact"><dt>Name</dt><dd>' + esc(r.name) + '</dd></div>'
      +     '<div class="fact"><dt>Tickets</dt><dd>' + r.quantity + '</dd></div>'
      +     '<div class="fact"><dt>Amount</dt><dd>'
      +       (price > 0 ? esc(App.money(amount, ev.currency)) : 'Free') + '</dd></div>'
      +   '</dl>'

      +   payBlock
      +   (ev.paymentNotice ? '<div class="prose prose--small"><p>' + esc(ev.paymentNotice) + '</p></div>' : '')
      + '</div>'

      + '<div class="card">'
      +   '<h2>Send us your registration</h2>'
      +   '<p class="muted">The organiser needs your details to issue the ticket. '
      +     'Use whichever is easiest &mdash; both send the same thing.</p>'

      +   '<div class="modal__actions" style="justify-content:flex-start">'
      +     '<a class="btn btn--primary" href="' + esc(mailHref) + '">Send by email</a>'
      +     '<button class="btn btn--ghost" type="button" id="copyCode">Copy code for WhatsApp/SMS</button>'
      +   '</div>'

      +   '<label class="field" style="margin-top:1rem">'
      +     '<span class="field__label">Your registration code</span>'
      +     '<textarea id="codeBox" rows="3" readonly>' + esc(code) + '</textarea>'
      +     '<span class="field__hint">Paste this to the organiser exactly as it is.</span>'
      +   '</label>'
      + '</div>'

      + '<div class="card">'
      +   '<h2>What happens next</h2>'
      +   '<ol class="steps">'
      +     (price > 0
            ? '<li><strong>Send the payment</strong> and include the reference <code>' + esc(r.ref) + '</code> in the note.</li>'
            : '')
      +     '<li><strong>Send your registration code</strong> using one of the buttons above.</li>'
      +     '<li><strong>Your ticket link arrives</strong> at <strong>' + esc(r.email) + '</strong> with a QR code to show at the door.</li>'
      +   '</ol>'
      +   '<p class="fineprint">Keep this page open or note your reference &mdash; you will need it if you contact the organiser.</p>'
      +   '<p class="fineprint"><a href="#" id="registerAnother">Register someone else on this device</a></p>'
      + '</div>';

    document.getElementById('registerAnother').addEventListener('click', function (e) {
      e.preventDefault();
      if (!confirm('Start a new registration? Note your reference first if you still need it.')) return;
      try { localStorage.removeItem(STORE_KEY); } catch (err) { /* nothing to clear */ }
      render(ev);
    });

    document.getElementById('copyRef').addEventListener('click', function () {
      App.copyText(r.ref);
      this.textContent = 'Copied';
    });
    document.getElementById('copyCode').addEventListener('click', function () {
      App.copyText(code);
      this.textContent = 'Copied — now paste it to the organiser';
    });
  }
})();
