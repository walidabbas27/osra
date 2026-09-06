/**
 * Door check-in, offline edition.
 *
 * Verification happens here on the device using the organiser's signing key,
 * so a forged QR is rejected without any server. Check-ins are recorded in
 * this browser's storage, which is what makes duplicate detection work - but
 * only for the codes THIS device has seen. Two phones scanning the same door
 * will not know about each other.
 *
 * Uses the browser's native BarcodeDetector where available (fast, hardware
 * accelerated) and falls back to jsQR, which works everywhere including iOS.
 */
(function () {
  'use strict';

  var KEY_SECRET = 'ticketing.scan.secret';
  var KEY_EVENT = 'ticketing.scan.event';
  var KEY_LOG = 'ticketing.scan.checkins';

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = App.escapeHtml;

  var video = $('#video');
  var canvas = $('#canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var resultEl = $('#result');
  var logEl = $('#log');
  var camHint = $('#camHint');
  var startBtn = $('#startBtn');
  var stopBtn = $('#stopBtn');

  var secret = App.load(KEY_SECRET, null);
  var eventName = App.load(KEY_EVENT, '');
  var checkIns = App.load(KEY_LOG, {});     // code -> { name, quantity, at, count }

  var stream = null, detector = null, scanning = false, busy = false;
  var lastPayload = '', lastAt = 0, pendingForce = null, beepCtx = null;

  // ------------------------------------------------------------- setup

  function showScanner() {
    $('#setupCard').hidden = true;
    $('#scannerUi').hidden = false;
    $('#eventLabel').textContent = eventName || 'This device only';
    refreshCounts();
    renderRecent();
  }

  if (secret) showScanner();

  $('#setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var value = e.target.elements.secret.value.trim();
    if (!value) return;

    secret = value;
    eventName = e.target.elements.event.value.trim();
    App.save(KEY_SECRET, secret);
    App.save(KEY_EVENT, eventName);
    showScanner();
  });

  $('#forgetKey').addEventListener('click', function () {
    if (!confirm('Remove the signing key from this device? Check-ins are kept.')) return;
    localStorage.removeItem(KEY_SECRET);
    location.reload();
  });

  $('#resetLog').addEventListener('click', function () {
    if (!confirm('Clear every check-in recorded on this device? This cannot be undone.')) return;
    checkIns = {};
    App.save(KEY_LOG, checkIns);
    refreshCounts();
    renderRecent();
  });

  $('#exportLog').addEventListener('click', function () {
    var rows = [['Code', 'Name', 'Quantity', 'Checked in at', 'Scans'].join(',')];
    Object.keys(checkIns).forEach(function (code) {
      var c = checkIns[code];
      rows.push(['"' + code + '"', '"' + String(c.name).replace(/"/g, '""') + '"',
                 c.quantity, '"' + c.at + '"', c.count].join(','));
    });
    App.download('checkins-' + new Date().toISOString().slice(0, 10) + '.csv',
      '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  });

  // ---------------------------------------------------------- feedback

  function beep(kind) {
    try {
      beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
      var pattern = { ok: [880, 0.12], duplicate: [520, 0.22], bad: [200, 0.35] }[kind] || [440, 0.15];
      var osc = beepCtx.createOscillator();
      var gain = beepCtx.createGain();
      osc.frequency.value = pattern[0];
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.22, beepCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, beepCtx.currentTime + pattern[1]);
      osc.connect(gain).connect(beepCtx.destination);
      osc.start();
      osc.stop(beepCtx.currentTime + pattern[1]);
    } catch (e) { /* audio blocked: the colour flash is the real signal */ }
  }

  function vibrate(kind) {
    if (!navigator.vibrate) return;
    navigator.vibrate(kind === 'ok' ? 60 : kind === 'duplicate' ? [50, 60, 50] : [90, 70, 90]);
  }

  function show(data) {
    var tone = data.result === 'ok' ? 'ok' : data.result === 'duplicate' ? 'duplicate' : 'bad';
    beep(tone);
    vibrate(tone);

    var icon = { ok: '✅', duplicate: '⚠️', refused: '⛔', invalid: '❌' }[data.result] || '❓';
    resultEl.className = 'result result--' + data.result;
    resultEl.innerHTML =
      '<div class="result__icon">' + icon + '</div>' +
      '<div class="result__title">' + esc(data.title) + '</div>' +
      (data.name ? '<div class="result__body"><strong>' + esc(data.name) + '</strong>' +
        (data.quantity > 1 ? ' · ' + data.quantity + ' people' : '') + '</div>' : '') +
      '<div class="result__body">' + esc(data.message) + '</div>' +
      (data.canForce ? '<button class="btn btn--small" id="forceBtn">Admit anyway</button>' : '');

    pendingForce = data.canForce ? lastPayload : null;
    var forceBtn = $('#forceBtn');
    if (forceBtn) forceBtn.addEventListener('click', function () { submit(pendingForce, true); });

    addLog(data);
    refreshCounts();
  }

  function addLog(data) {
    var empty = logEl.querySelector('.log__empty');
    if (empty) empty.remove();
    var li = document.createElement('li');
    li.innerHTML = '<span>' + esc(data.name || data.title) + '</span>' +
      '<span class="log__res log__res--' + data.result + '">' + esc(data.result) + ' · ' +
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>';
    logEl.prepend(li);
    while (logEl.children.length > 15) logEl.lastElementChild.remove();
  }

  function renderRecent() {
    var codes = Object.keys(checkIns).sort(function (a, b) {
      return String(checkIns[b].at).localeCompare(String(checkIns[a].at));
    }).slice(0, 15);

    if (!codes.length) {
      logEl.innerHTML = '<li class="log__empty">Nothing scanned yet.</li>';
      return;
    }
    logEl.innerHTML = codes.map(function (code) {
      var c = checkIns[code];
      return '<li><span>' + esc(c.name) + '</span>'
        + '<span class="log__res log__res--ok">in · '
        + new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        + '</span></li>';
    }).join('');
  }

  // ------------------------------------------------------ verification

  /** Checks the signature, then this device's own record of who is already in. */
  function verify(payload, force) {
    return App.verifyQrString(secret, payload).then(function (ticket) {
      if (!ticket) {
        // Hand-typed bare codes cannot be verified - there is no signature to
        // check - so they are only matched against people already scanned in.
        var bare = String(payload || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (/^[A-Z0-9]{20}$/.test(bare) && checkIns[bare]) {
          return {
            result: 'duplicate', name: checkIns[bare].name, quantity: checkIns[bare].quantity,
            title: 'Already checked in',
            message: 'Scanned at ' + new Date(checkIns[bare].at).toLocaleTimeString()
                     + ' · ' + checkIns[bare].count + ' scans.',
            canForce: true
          };
        }
        if (/^[A-Z0-9]{20}$/.test(bare)) {
          return {
            result: 'refused', title: 'Cannot verify by hand',
            message: 'A typed code carries no signature. Scan the QR, or check the name against your list.'
          };
        }
        return {
          result: 'invalid', title: 'Not a valid ticket',
          message: 'That code was not issued for this event, or the signing key on this device is wrong.'
        };
      }

      var existing = checkIns[ticket.code];
      if (existing && !force) {
        existing.count += 1;
        App.save(KEY_LOG, checkIns);
        return {
          result: 'duplicate', name: ticket.name, quantity: ticket.quantity,
          title: 'Already checked in',
          message: 'Scanned at ' + new Date(existing.at).toLocaleTimeString()
                   + ' · ' + existing.count + ' scans total.',
          canForce: true
        };
      }

      checkIns[ticket.code] = {
        name: ticket.name,
        quantity: ticket.quantity,
        at: existing ? existing.at : new Date().toISOString(),
        count: existing ? existing.count + 1 : 1
      };
      App.save(KEY_LOG, checkIns);

      return {
        result: 'ok', name: ticket.name, quantity: ticket.quantity,
        title: force ? 'Admitted again' : 'Welcome in',
        message: ticket.quantity > 1 ? 'Admit ' + ticket.quantity + ' people.' : 'Admit 1 person.'
      };
    });
  }

  function submit(payload, force) {
    if (busy || !payload) return;
    busy = true;
    lastPayload = payload;

    verify(payload, force)
      .then(show)
      .catch(function (err) {
        show({ result: 'invalid', title: 'Could not check that code', message: err.message });
      })
      .then(function () {
        // Brief lock-out stops one QR being re-read 30x while held up.
        setTimeout(function () { busy = false; }, 900);
      });
  }

  function onDecoded(text) {
    var now = Date.now();
    if (text === lastPayload && now - lastAt < 2500) return;
    lastAt = now;
    submit(text, false);
  }

  function refreshCounts() {
    var people = 0, scans = 0;
    Object.keys(checkIns).forEach(function (code) {
      people += checkIns[code].quantity || 1;
      scans += checkIns[code].count || 1;
    });
    $('#cIn').textContent = people;
    $('#cScans').textContent = scans;
  }

  // ------------------------------------------------------------- camera

  function tick() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      if (detector) {
        detector.detect(video)
          .then(function (codes) { if (codes && codes.length) onDecoded(codes[0].rawValue); })
          .catch(function () { detector = null; });   // fall back to jsQR
      } else if (window.jsQR) {
        var w = video.videoWidth, h = video.videoHeight;
        if (w && h) {
          // Downscale: jsQR is much faster on a smaller frame, and a QR held up
          // to the camera is large enough to survive it.
          var scale = Math.min(1, 640 / w);
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var found = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          if (found && found.data) onDecoded(found.data);
        }
      }
    }
    requestAnimationFrame(tick);
  }

  function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camHint.textContent = 'This browser cannot open the camera. Use the manual code box below.';
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(function () {
        camHint.hidden = true;
        scanning = true;
        startBtn.hidden = true;
        stopBtn.hidden = false;
        startBtn.disabled = false;
        startBtn.textContent = 'Start camera';

        if ('BarcodeDetector' in window) {
          window.BarcodeDetector.getSupportedFormats()
            .then(function (formats) {
              if (formats.indexOf('qr_code') !== -1) {
                detector = new window.BarcodeDetector({ formats: ['qr_code'] });
              }
            })
            .catch(function () { detector = null; });
        }
        requestAnimationFrame(tick);
      })
      .catch(function (err) {
        startBtn.disabled = false;
        startBtn.textContent = 'Start camera';
        camHint.textContent = err && err.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow it in the browser, or use the manual code box.'
          : 'Could not open the camera (' + (err && err.name) + '). Use the manual code box below.';
      });
  }

  function stop() {
    scanning = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    video.srcObject = null;
    camHint.hidden = false;
    camHint.textContent = 'Camera stopped';
    stopBtn.hidden = true;
    startBtn.hidden = false;
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);

  $('#manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#manualCode');
    var value = input.value.trim();
    if (!value) return;
    lastPayload = '';
    submit(value, false);
    input.value = '';
  });

  // Camera streams are dropped when the tab is backgrounded on mobile.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && scanning) stop();
  });
})();
