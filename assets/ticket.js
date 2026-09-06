/**
 * Renders an attendee's ticket.
 *
 * Everything comes from the URL hash, which the browser never sends to a
 * server, so no lookup is needed and nothing about the attendee is logged
 * anywhere. The QR string was signed by the organiser when the ticket was
 * issued; this page only draws it.
 */
(function () {
  'use strict';

  var esc = App.escapeHtml;
  var root = document.getElementById('root');

  function fail(title, message) {
    root.innerHTML = '<div class="card card--center">'
      + '<div class="glyph">&#127903;</div>'
      + '<h1>' + esc(title) + '</h1>'
      + '<p class="muted">' + esc(message) + '</p>'
      + '</div>';
  }

  var hash = location.hash.replace(/^#/, '');
  if (!hash) {
    fail('No ticket here', 'This link is missing its ticket data. Ask the organiser to resend it.');
    return;
  }

  var t;
  try {
    t = App.decodeJson(hash);
  } catch (e) {
    fail('Ticket link is damaged', 'The link was cut short or altered. Copy it again from the original message.');
    return;
  }

  if (!t || !t.qr || !t.c) {
    fail('Ticket link is incomplete', 'Ask the organiser to resend your ticket link.');
    return;
  }

  var when = [t.d, t.w].filter(Boolean);
  var where = [t.w, t.a].filter(Boolean).join(', ');

  root.innerHTML = ''
    + '<div class="ticket">'
    +   '<div class="ticket__top">'
    +     (t.b ? '<div class="ticket__brand">' + esc(t.b) + '</div>' : '')
    +     '<h1 class="ticket__event">' + esc(t.e || 'Your ticket') + '</h1>'
    +     (t.d ? '<div class="ticket__when">' + esc(t.d) + '</div>' : '')
    +     (where ? '<div class="ticket__where">' + esc(where) + '</div>' : '')
    +   '</div>'
    +   '<div class="ticket__perf"></div>'
    +   '<div class="ticket__bottom">'
    +     '<canvas id="qr" class="ticket__qr" width="300" height="300"></canvas>'
    +     '<div class="ticket__code">' + esc(t.c) + '</div>'
    +     '<div class="ticket__meta">'
    +       '<span>' + esc(t.n || '') + '</span>'
    +       '<span>Admits ' + (parseInt(t.q, 10) || 1) + '</span>'
    +     '</div>'
    +     '<div class="badge badge--valid">Show this at the door</div>'
    +   '</div>'
    + '</div>'
    + '<p class="fineprint fineprint--center">'
    +   'Turn your screen brightness up before scanning. '
    +   '<a href="#" id="save">Save the QR image</a> so it works without signal.'
    + '</p>';

  try {
    QR.toCanvas(t.qr, { canvas: document.getElementById('qr'), scale: 6, margin: 4 });
  } catch (e) {
    fail('Could not draw the ticket', e.message);
    return;
  }

  document.getElementById('save').addEventListener('click', function (e) {
    e.preventDefault();
    document.getElementById('qr').toBlob(function (blob) {
      App.download('ticket-' + t.c + '.png', blob);
    });
  });
})();
