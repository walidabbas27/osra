/**
 * Shared helpers: encoding, signing, and local storage.
 *
 * There is no server here. Tickets carry their own data in the URL, and the
 * signing key lives only on the organiser's and door staff's own devices -
 * never in this repository, and never in a ticket.
 */
var App = (function () {
  'use strict';

  var TICKET_PREFIX = 'TKT2:';
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no look-alike characters

  // ------------------------------------------------------------- encoding

  function bytesToB64url(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(text) {
    var padded = text.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    var binary = atob(padded);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function encodeJson(value) {
    return bytesToB64url(new TextEncoder().encode(JSON.stringify(value)));
  }

  function decodeJson(text) {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(text)));
  }

  // -------------------------------------------------------------- signing

  /** A 20-character code: 100 bits of entropy, readable off a screen. */
  function newCode() {
    var bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < 20; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }

  /** Short reference for the payment note, e.g. "K7P-4RM2". */
  function newRef() {
    var bytes = new Uint8Array(7);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < 7; i++) {
      out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      if (i === 2) out += '-';
    }
    return out;
  }

  /** A fresh signing key for an event. */
  function newSecret() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToB64url(bytes);
  }

  function requireCrypto() {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        'This browser cannot sign tickets here. The page must be served over https:// ' +
        '(or localhost) - opening the file directly from disk will not work.'
      );
    }
  }

  /** Truncated HMAC-SHA256, matching the server edition's scheme. */
  function sign(secret, message) {
    requireCrypto();
    var enc = new TextEncoder();
    return crypto.subtle
      .importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (key) { return crypto.subtle.sign('HMAC', key, enc.encode(message)); })
      .then(function (buf) { return bytesToB64url(new Uint8Array(buf)).slice(0, 16); });
  }

  /** Comparison that does not leak where two signatures first differ. */
  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /**
   * Builds the string that goes inside the QR image. Deliberately compact -
   * only what the door needs - so the code stays small and scans fast.
   */
  function buildQrString(secret, ticket) {
    var body = encodeJson({ c: ticket.code, n: ticket.name, q: ticket.quantity });
    return sign(secret, body).then(function (sig) { return TICKET_PREFIX + body + '.' + sig; });
  }

  /** Verifies a scanned QR string and returns its contents. */
  function verifyQrString(secret, raw) {
    var text = String(raw || '').trim();
    if (text.indexOf(TICKET_PREFIX) !== 0) return Promise.resolve(null);

    var rest = text.slice(TICKET_PREFIX.length);
    var dot = rest.lastIndexOf('.');
    if (dot < 0) return Promise.resolve(null);

    var body = rest.slice(0, dot);
    var provided = rest.slice(dot + 1);

    return sign(secret, body).then(function (expected) {
      if (!safeEqual(expected, provided)) return null;
      try {
        var data = decodeJson(body);
        return { code: data.c, name: data.n, quantity: data.q || 1 };
      } catch (e) {
        return null;
      }
    });
  }

  /** The link an attendee opens. Data sits in the hash, so it never leaves the browser. */
  function buildTicketUrl(baseHref, event, ticket, qrString) {
    var payload = encodeJson({
      v: 1,
      e: event.name, d: event.startsAt, w: event.venue, a: event.address,
      b: event.brand, n: ticket.name, q: ticket.quantity, c: ticket.code,
      r: ticket.ref, qr: qrString
    });
    return baseHref.replace(/[^/]*$/, '') + 'ticket.html#' + payload;
  }

  // -------------------------------------------------------------- storage

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // --------------------------------------------------------------- misc

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(amount, currency) {
    var symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$' };
    var code = (currency || 'USD').toUpperCase();
    var value = (Number(amount) || 0).toFixed(2);
    return symbols[code] ? symbols[code] + value : value + ' ' + code;
  }

  function formatWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
  }

  /** Offers a generated file to the user without needing a server. */
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for browsers that block the async clipboard on http://
    var el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(el);
    return Promise.resolve();
  }

  return {
    TICKET_PREFIX: TICKET_PREFIX,
    encodeJson: encodeJson, decodeJson: decodeJson,
    newCode: newCode, newRef: newRef, newSecret: newSecret,
    sign: sign, safeEqual: safeEqual,
    buildQrString: buildQrString, verifyQrString: verifyQrString, buildTicketUrl: buildTicketUrl,
    load: load, save: save,
    escapeHtml: escapeHtml, money: money, formatWhen: formatWhen,
    download: download, copyText: copyText
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App;
