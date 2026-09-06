/**
 * Organiser console. Owns the event, the attendee list and the signing key,
 * all held in this browser's local storage.
 */
(function () {
  'use strict';

  var KEY_EVENT = 'ticketing.event';
  var KEY_LIST = 'ticketing.attendees';
  var KEY_SECRET = 'ticketing.secret';
  var KEY_PUBLIC = 'ticketing.publickey';

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = App.escapeHtml;

  var state = {
    event: App.load(KEY_EVENT, {
      brand: '', name: '', tagline: '', startsAt: '', doorsAt: '', venue: '', address: '',
      price: 0, currency: 'USD', paymentLink: '', paymentLabel: 'Pay now', paymentNotice: '',
      description: '', organiserEmail: '', maxPerPerson: 1, instantMode: false
    }),
    attendees: App.load(KEY_LIST, []),
    // Private. Signs tickets in the normal flow, and never leaves this device.
    secret: App.load(KEY_SECRET, null),
    // Public on purpose. In instant mode the sign-up page has to sign tickets
    // itself, so this key travels inside the public link. It is deliberately a
    // DIFFERENT key from the secret above, so publishing it can never let
    // anyone forge a normal ticket.
    publicKey: App.load(KEY_PUBLIC, null)
  };

  if (!window.crypto || !window.crypto.subtle) $('#cryptoWarning').hidden = false;

  if (!state.secret) {
    state.secret = App.newSecret();
    App.save(KEY_SECRET, state.secret);
  }
  if (!state.publicKey) {
    state.publicKey = App.newSecret();
    App.save(KEY_PUBLIC, state.publicKey);
  }

  function persist() {
    App.save(KEY_EVENT, state.event);
    App.save(KEY_LIST, state.attendees);
    App.save(KEY_SECRET, state.secret);
    App.save(KEY_PUBLIC, state.publicKey);
  }

  /** The key tickets are signed with, which depends on the mode. */
  function signingKey() {
    return state.event.instantMode ? state.publicKey : state.secret;
  }

  // ------------------------------------------------------------ event form

  var eventForm = $('#eventForm');

  function fillEventForm() {
    Object.keys(state.event).forEach(function (key) {
      var field = eventForm.elements[key];
      if (!field) return;
      if (field.type === 'checkbox') field.checked = !!state.event[key];
      else field.value = state.event[key];
    });
    $('#brandLabel').textContent = state.event.brand || 'Event ticketing';
    $('#secretValue').textContent = state.secret;
    $('#instantBanner').hidden = !state.event.instantMode;
    $('#doorFileRow').hidden = !state.event.instantMode;
    fillSignupLink();
  }

  /** The public sign-up link, with the event details riding in the hash. */
  function signupUrl() {
    var base = location.href.replace(/[^/]*$/, '');
    return base + 'index.html#' + App.encodeJson(publicEvent());
  }

  /**
   * Only the fields attendees should see. The private secret is never included
   * here under any mode; in instant mode the separate public key is, because
   * the sign-up page needs it to sign the ticket it hands out on the spot.
   */
  function publicEvent() {
    var e = state.event;
    var out = {
      brand: e.brand, name: e.name, tagline: e.tagline, startsAt: e.startsAt, doorsAt: e.doorsAt,
      venue: e.venue, address: e.address, price: Number(e.price) || 0, currency: e.currency,
      description: e.description, paymentLink: e.paymentLink, paymentLabel: e.paymentLabel,
      paymentNotice: e.paymentNotice, organiserEmail: e.organiserEmail,
      maxPerPerson: Math.max(1, parseInt(e.maxPerPerson, 10) || 1),
      instantMode: !!e.instantMode
    };
    if (e.instantMode) out.publicKey = state.publicKey;
    return out;
  }

  function fillSignupLink() {
    var ready = !!state.event.name;
    var url = ready ? signupUrl() : '';
    $('#signupLink').textContent = ready ? url : 'Save your event first';
    $('#openSignup').href = ready ? url : 'index.html';
  }

  eventForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = new FormData(eventForm);
    data.forEach(function (value, key) { state.event[key] = value; });
    // Unchecked boxes are absent from FormData, so read them directly.
    state.event.instantMode = eventForm.elements.instantMode.checked;
    state.event.price = Number(state.event.price) || 0;
    state.event.currency = (state.event.currency || 'USD').toUpperCase().slice(0, 3);
    persist();
    fillEventForm();
    render();
    flash(eventForm, 'Event saved');
  });

  // --------------------------------------------------------- signing key

  $('#copySignup').addEventListener('click', function () {
    if (!state.event.name) return;
    App.copyText(signupUrl()).then(function () { flash($('#copySignup'), 'Copied'); });
  });

  $('#downloadEventJson').addEventListener('click', function () {
    if (!state.event.name) { alert('Save your event first.'); return; }
    App.download('event.json', JSON.stringify(publicEvent(), null, 2), 'application/json');
  });

  /**
   * The door file. In instant mode the ticket alone proves nothing, so the
   * scanner needs the list of people whose payment you have confirmed. Rebuild
   * and reload this whenever you tick more people off.
   */
  $('#downloadDoorFile').addEventListener('click', function () {
    if (!state.event.name) { alert('Save your event first.'); return; }

    var approved = state.attendees
      .filter(function (a) { return a.paid; })
      .map(function (a) { return a.code; });

    App.download('door-list.json', JSON.stringify({
      version: 1,
      eventName: state.event.name,
      instantMode: !!state.event.instantMode,
      key: signingKey(),
      approved: approved,
      exportedAt: new Date().toISOString()
    }, null, 2), 'application/json');

    flash($('#downloadDoorFile'), approved.length + ' confirmed');
  });

  // ------------------------------------------------- registration codes

  $('#codeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var box = $('#regCode');
    var errorBox = $('#codeError');
    var raw = box.value.trim();
    errorBox.innerHTML = '';

    // Tolerate the code being pasted inside a whole forwarded email.
    var match = raw.match(/REG1:[A-Za-z0-9_-]+/);
    if (!match) {
      errorBox.innerHTML = '<div class="notice notice--error"><strong>No registration code found.</strong>'
        + '<span>Look for the line starting with <code>REG1:</code> and paste that.</span></div>';
      return;
    }

    var reg;
    try {
      reg = App.decodeJson(match[0].slice('REG1:'.length));
    } catch (err) {
      errorBox.innerHTML = '<div class="notice notice--error"><strong>That code is damaged.</strong>'
        + '<span>It was probably cut short. Ask them to send it again.</span></div>';
      return;
    }

    if (!reg || !reg.n) {
      errorBox.innerHTML = '<div class="notice notice--error"><strong>That code has no name in it.</strong></div>';
      return;
    }

    var already = state.attendees.filter(function (a) { return a.ref === reg.r; })[0];
    if (already) {
      errorBox.innerHTML = '<div class="notice notice--warn"><strong>Already added.</strong>'
        + '<span>' + esc(already.name) + ' is on the list with reference ' + esc(already.ref) + '.</span></div>';
      box.value = '';
      return;
    }

    state.attendees.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name: String(reg.n).trim(),
      email: String(reg.e || '').trim().toLowerCase(),
      phone: String(reg.p || '').trim(),
      quantity: Math.min(20, Math.max(1, parseInt(reg.q, 10) || 1)),
      code: reg.c || App.newCode(),
      ref: reg.r || App.newRef(),
      // Instant mode: they were handed the ticket at sign-up, so it already exists.
      paid: false, issued: !!reg.c, url: reg.u || '', qr: reg.k || '',
      addedAt: new Date().toISOString()
    });

    box.value = '';
    persist();
    render();
    errorBox.innerHTML = '<div class="notice notice--ok"><strong>Added ' + esc(reg.n) + '.</strong>'
      + '<span>Tick <em>paid</em> once you have matched their payment to reference '
      + esc(reg.r || '') + '.</span></div>';
  });

  $('#copySecret').addEventListener('click', function () {
    App.copyText(state.secret).then(function () { flash($('#copySecret'), 'Copied'); });
  });

  $('#regenSecret').addEventListener('click', function () {
    var issued = state.attendees.filter(function (a) { return a.issued; }).length;
    var warning = issued
      ? 'You have already issued ' + issued + ' ticket(s). A new key stops every one of them scanning. Continue?'
      : 'Generate a new signing key?';
    if (!confirm(warning)) return;

    if (state.event.instantMode) {
      state.publicKey = App.newSecret();
    } else {
      state.secret = App.newSecret();
    }
    // Previously issued tickets can no longer verify, so drop their links.
    state.attendees.forEach(function (a) { a.issued = false; a.url = ''; a.qr = ''; });
    persist();
    fillEventForm();
    render();
  });

  // ----------------------------------------------------------- attendees

  $('#attendeeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var name = form.elements.name.value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return;

    state.attendees.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name: name,
      email: form.elements.email.value.trim().toLowerCase(),
      quantity: Math.min(20, Math.max(1, parseInt(form.elements.quantity.value, 10) || 1)),
      code: App.newCode(),
      ref: App.newRef(),
      paid: false,
      issued: false,
      url: '',
      qr: '',
      addedAt: new Date().toISOString()
    });

    form.reset();
    form.elements.quantity.value = '1';
    form.elements.name.focus();
    persist();
    render();
  });

  function find(id) {
    return state.attendees.filter(function (a) { return a.id === id; })[0];
  }

  /** Signs a ticket and stores its link. Everything else is display. */
  function issueTicket(attendee) {
    return App.buildQrString(signingKey(), attendee)
      .then(function (qrString) {
        attendee.qr = qrString;
        attendee.url = App.buildTicketUrl(location.href, state.event, attendee, qrString);
        attendee.issued = true;
        attendee.issuedAt = new Date().toISOString();
        persist();
        render();
        return attendee;
      })
      .catch(function (err) {
        alert(err.message);
        throw err;
      });
    }

  function ensureIssued(attendee) {
    return attendee.issued && attendee.qr ? Promise.resolve(attendee) : issueTicket(attendee);
  }

  // -------------------------------------------------------------- render

  function stats() {
    var registered = 0, paid = 0, pending = 0, issued = 0, revenue = 0;
    state.attendees.forEach(function (a) {
      registered += a.quantity;
      if (a.paid) { paid += a.quantity; revenue += a.quantity * (Number(state.event.price) || 0); }
      else pending += a.quantity;
      if (a.issued) issued += a.quantity;
    });
    return { registered: registered, paid: paid, pending: pending, issued: issued, revenue: revenue };
  }

  function render() {
    var s = stats();
    $('#cRegistered').textContent = s.registered;
    $('#cPaid').textContent = s.paid;
    $('#cPending').textContent = s.pending;
    $('#cIssued').textContent = s.issued;
    $('#cRevenue').textContent = s.revenue > 0 ? App.money(s.revenue, state.event.currency) + ' collected' : '';

    var term = $('#search').value.trim().toLowerCase();
    var rows = state.attendees.filter(function (a) {
      if (!term) return true;
      return (a.name + ' ' + a.email + ' ' + a.ref).toLowerCase().indexOf(term) >= 0;
    });

    var tbody = $('#attendeeTable').querySelector('tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">'
        + (state.attendees.length ? 'Nothing matches that search.' : 'No attendees yet. Add the first one above.')
        + '</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (a) {
      var contact = a.email
        ? '<a href="mailto:' + esc(a.email) + '">' + esc(a.email) + '</a>'
        : '<span class="muted">no email</span>';

      var ticketCell = a.issued
        ? '<span class="pill pill--ok">Issued</span>'
        : (a.paid ? '<span class="pill pill--warn">Ready to issue</span>'
                  : '<span class="muted">mark paid first</span>');

      var actions = [];
      if (a.paid) {
        actions.push('<button class="btn btn--small btn--primary" data-act="qr" data-id="' + a.id + '">QR</button>');
        actions.push('<button class="btn btn--small btn--ghost" data-act="link" data-id="' + a.id + '">Copy link</button>');
        if (a.email) actions.push('<button class="btn btn--small btn--ghost" data-act="mail" data-id="' + a.id + '">Email</button>');
      }
      actions.push('<button class="btn btn--small btn--danger" data-act="del" data-id="' + a.id + '">Delete</button>');

      return '<tr>'
        + '<td><div class="who"><strong>' + esc(a.name) + '</strong>' + contact + '</div></td>'
        + '<td><code>' + esc(a.ref) + '</code></td>'
        + '<td class="col-num">' + a.quantity + '</td>'
        + '<td><label class="check check--inline"><input type="checkbox" data-act="paid" data-id="' + a.id + '"'
            + (a.paid ? ' checked' : '') + '> paid</label></td>'
        + '<td>' + ticketCell + '</td>'
        + '<td class="col-actions">' + actions.join(' ') + '</td>'
        + '</tr>';
    }).join('');
  }

  $('#search').addEventListener('input', render);

  // ------------------------------------------------------------- actions

  $('#attendeeTable').addEventListener('change', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act !== 'paid') return;

    var attendee = find(e.target.getAttribute('data-id'));
    if (!attendee) return;

    attendee.paid = e.target.checked;
    persist();

    // Confirming payment is what issues the ticket, mirroring the server edition.
    if (attendee.paid && !attendee.issued) issueTicket(attendee); else render();
  });

  $('#attendeeTable').addEventListener('click', function (e) {
    var button = e.target.closest('button[data-act]');
    if (!button) return;

    var attendee = find(button.getAttribute('data-id'));
    if (!attendee) return;

    switch (button.getAttribute('data-act')) {
      case 'qr':
        ensureIssued(attendee).then(showQr);
        break;

      case 'link':
        ensureIssued(attendee).then(function (a) {
          App.copyText(a.url).then(function () { flash(button, 'Copied'); });
        });
        break;

      case 'mail':
        ensureIssued(attendee).then(function (a) {
          var subject = 'Your ticket for ' + (state.event.name || 'the event');
          var body = [
            'Hi ' + a.name.split(' ')[0] + ',',
            '',
            'Your ticket for ' + (state.event.name || 'the event') + ' is confirmed.',
            state.event.startsAt ? 'When: ' + state.event.startsAt : '',
            state.event.venue ? 'Where: ' + [state.event.venue, state.event.address].filter(Boolean).join(', ') : '',
            'Admits: ' + a.quantity,
            '',
            'Open your ticket here and show the QR code at the door:',
            a.url,
            '',
            state.event.brand || ''
          ].filter(Boolean).join('\n');

          location.href = 'mailto:' + encodeURIComponent(a.email)
            + '?subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(body);
        });
        break;

      case 'del':
        if (!confirm('Remove ' + attendee.name + ' from the list?')) return;
        state.attendees = state.attendees.filter(function (a) { return a.id !== attendee.id; });
        persist();
        render();
        break;
    }
  });

  // ------------------------------------------------------------ QR modal

  var qrModal = $('#qrModal');
  var currentQrName = '';

  function showQr(attendee) {
    currentQrName = attendee.code;
    $('#qrTitle').textContent = attendee.name;
    $('#qrCode').textContent = attendee.code;
    QR.toCanvas(attendee.qr, { canvas: $('#qrCanvas'), scale: 6, margin: 4 });
    qrModal.hidden = false;
  }

  $('#qrClose').addEventListener('click', function () { qrModal.hidden = true; });
  qrModal.addEventListener('click', function (e) { if (e.target === qrModal) qrModal.hidden = true; });

  $('#qrDownload').addEventListener('click', function () {
    $('#qrCanvas').toBlob(function (blob) {
      App.download('ticket-' + currentQrName + '.png', blob);
    });
  });

  // ------------------------------------------------------- export/backup

  $('#exportCsv').addEventListener('click', function () {
    var cell = function (v) {
      var s = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;               // stop spreadsheets running it as a formula
      return '"' + s.replace(/"/g, '""') + '"';
    };

    var header = ['Name', 'Email', 'Reference', 'Code', 'Quantity', 'Paid', 'Ticket issued', 'Ticket link'];
    var lines = [header.map(cell).join(',')];
    state.attendees.forEach(function (a) {
      lines.push([a.name, a.email, a.ref, a.code, a.quantity,
                  a.paid ? 'yes' : 'no', a.issued ? 'yes' : 'no', a.url].map(cell).join(','));
    });

    var slug = (state.event.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    App.download(slug + '-' + new Date().toISOString().slice(0, 10) + '.csv',
      '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  });

  $('#backupBtn').addEventListener('click', function () {
    var payload = { version: 1, exportedAt: new Date().toISOString(),
                    event: state.event, secret: state.secret, attendees: state.attendees };
    var slug = (state.event.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    App.download(slug + '-backup-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify(payload, null, 2), 'application/json');
  });

  $('#restoreBtn').addEventListener('click', function () { $('#restoreFile').click(); });

  $('#restoreFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.event || !data.attendees) throw new Error('Not a ticketing backup file.');
        if (!confirm('Replace the event and all ' + state.attendees.length + ' attendees currently in this browser?')) return;

        state.event = data.event;
        state.attendees = data.attendees;
        if (data.secret) state.secret = data.secret;
        persist();
        fillEventForm();
        render();
        alert('Restored ' + state.attendees.length + ' attendees.');
      } catch (err) {
        alert('Could not read that file: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // --------------------------------------------------------------- utils

  function flash(nearElement, message) {
    var note = document.createElement('span');
    note.className = 'flash';
    note.textContent = message;
    nearElement.parentNode.insertBefore(note, nearElement.nextSibling);
    setTimeout(function () { note.remove(); }, 1600);
  }

  fillEventForm();
  render();
})();
