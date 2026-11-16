// The pop-up about an event (Backend > Popups): "Don't forget to register for the next season". It looks like the registration window: the photo of the event
// on top with "Registration for …" and its name, the dates, the player's own data already filled in, and two buttons. "I want to register" registers him at
// once; "I don't want to register" ends it for good; the cross closes it and it comes back after the days the organiser set (3 by default).
// check() asks the server what to show to the logged-in player on this page; show(popup, { preview }) draws one (the Backend's preview uses it too).
(function eventPopup() {
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const lang = () => (typeof currentLang === 'string' ? currentLang : 'sk');
  const pick = (o) => (o && (o[lang()] || o.sk || o.en)) || '';
  const isDoubles = (ev) => ev.kind === 'TOURNAMENT' && ev.playType === 'DOUBLES';
  const fmt = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.${y}`; };
  // "27. – 28. 9. 2025" for a tournament, "1.9.2026 – 30.6.2027" for a season
  function termOf(ev) {
    if (!ev.startDate) return '';
    if (!ev.endDate || ev.endDate === ev.startDate) return fmt(ev.startDate);
    const [y1, m1, d1] = ev.startDate.split('-').map(Number);
    const [y2, m2, d2] = ev.endDate.split('-').map(Number);
    if (y1 === y2 && m1 === m2) return `${d1}. – ${d2}. ${m2}. ${y2}`;
    return `${fmt(ev.startDate)} – ${fmt(ev.endDate)}`;
  }
  const hasFee = (ev) => {
    const fee = String(ev.entryFee || '').trim();
    if (!fee) return !!ev.paymentUrl;
    const n = fee.replace(',', '.').match(/\d+(?:\.\d+)?/);
    return n ? Number(n[0]) > 0 : !/^(zadarmo|free)\b/i.test(fee);
  };

  let open = false;

  // how to pay by bank transfer: the IBAN with a Copy button, the recipient, the amount and the note to write (the same block as on the page of the event)
  function bankHtml(contact, ev, payerName, preview) {
    const iban = ev.iban || (contact && contact.iban) || '';
    if (!iban) return '';
    contact = { ...(contact || {}), iban };
    const customNote = String(ev.payNote || '').trim() ? String(ev.payNote).split('{turnaj}').join(ev.name).split('{meno}').join(payerName || '').trim() : '';
    const row = (label, value, copy) => `<div class="sv-pay-row"><span>${esc(label)}</span><b>${esc(value)}</b>${copy ? `<button type="button" class="sv-pay-copy" data-copy="${esc(copy)}">${esc(t('season.copy'))}</button>` : ''}</div>`;
    return `<div class="sv-pay-bank">
      <h4>${esc(ev.payTitle || t('popup.payTransfer'))}</h4>
      ${row('IBAN', contact.iban, contact.iban.replace(/\s+/g, ''))}
      ${(ev.payRecipient || contact.orgName) ? row(t('season.payTransferRecipient'), ev.payRecipient || contact.orgName) : ''}
      ${ev.entryFee ? row(t('season.payTransferAmount'), ev.entryFee) : ''}
      ${customNote ? row(t('season.payTransferNoteLabel'), customNote, customNote) : `<p class="sv-pay-note">${esc(t('season.payTransferNote', { name: ev.name }))}</p>`}
      <div class="sv-pay-qr"><img src="/api/seasons/${ev.id}/payment-qr?for=${encodeURIComponent(payerName || '')}${ev.qrExtra || ''}" alt="QR" width="200" height="200"><span>${esc(t('season.payQr'))}</span></div>
    </div>`;
  }

  function show(popup, { preview = false, onDone } = {}) {
    if (open || !popup || !popup.event) return;
    open = true;
    const ev = popup.event;
    const tournament = ev.kind === 'TOURNAMENT';
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop ep-backdrop';
    const heroWide = ev.heroUrl || ev.heroMobileUrl;
    const heroPhone = ev.heroMobileUrl || ev.heroUrl;
    const label = esc(t(tournament ? 'popup.forTournament' : 'popup.forSeason'));
    const closeLabel = esc(t('season.regClose'));
    const more = `<a class="ep-more" id="ep-more" href="${esc(typeof siteUrl === 'function' ? siteUrl(ev.codePath) : ev.codePath)}">${esc(t('popup.moreInfo'))}</a>`;
    const head = heroWide
      ? `<div class="sv-reg-cover">
          <picture><source media="(max-width: 480px)" srcset="${esc(heroPhone)}"><img src="${esc(heroWide)}" alt=""></picture><span class="sv-reg-shade"></span>
          <button type="button" class="close" data-dismiss aria-label="${closeLabel}">&times;</button>
          <div class="sv-reg-cover-text ep-nameRow"><div><h3>${label}</h3><div class="sv-reg-season">${esc(ev.name)}</div></div>${more}</div>
        </div>`
      : `<button type="button" class="close" data-dismiss aria-label="${closeLabel}">&times;</button><div class="ep-nameRow plain"><div><h3>${label}</h3><div class="sv-reg-season">${esc(ev.name)}</div></div>${more}</div>`;
    const headline = pick(popup.headline) || t('popup.defaultHeadline');
    const message = pick(popup.message);
    const term = termOf(ev);
    const venue = tournament ? ev.venue : ''; // a season is played anywhere: only a tournament has a place
    wrap.innerHTML = `
      <div class="modal sv-reg ep" role="dialog" aria-modal="true" aria-label="${esc(headline)}">
        ${head}
        <div class="ep-body">
          <p class="ep-headline">${esc(headline)}</p>
          ${message ? `<p class="ep-message">${esc(message).replace(/\n/g, '<br>')}</p>` : ''}
          ${term || venue ? `<div class="ep-facts">${term ? `<span><b>${esc(t('popup.term'))}</b> ${esc(term)}</span>` : ''}${venue ? `<span><b>${esc(t('popup.venue'))}</b> ${esc(venue)}</span>` : ''}</div>` : ''}
          <form id="ep-form" novalidate>
            <div class="field"><label for="ep-name">${esc(t('season.regName'))}</label><input type="text" id="ep-name" readonly maxlength="80"></div>
            <div class="ep-row">
              <div class="field"><label for="ep-phone">${esc(t('season.regPhone'))}</label><input type="tel" id="ep-phone" autocomplete="tel" maxlength="20" placeholder="0903 111 222"></div>
              <div class="field"><label for="ep-email">${esc(t('season.regEmail'))}</label><input type="email" id="ep-email" autocomplete="email" maxlength="120"></div>
            </div>
            ${isDoubles(ev) ? `<div class="field"><label for="ep-partner">${esc(t('season.regPartner'))}</label><input type="text" id="ep-partner" maxlength="80" autocomplete="off"><small>${esc(t('season.regPartnerHint'))}</small></div>` : ''}
            <div class="sv-reg-error" id="ep-error"></div>
            <button type="submit" class="btn btn-primary btn-block" id="ep-yes">${esc(t('popup.yes'))}</button>
            <button type="button" class="ep-no" id="ep-no">${esc(t('popup.no'))}</button>
            <p class="ep-later">${esc(t(preview ? 'popup.previewNote' : 'popup.later'))}</p>
          </form>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const $ = (id) => wrap.querySelector(`#ep-${id}`);
    let finished = false;
    const finish = () => { if (finished) return; finished = true; document.removeEventListener('keydown', onKey); wrap.remove(); open = false; if (onDone) onDone(); };
    const post = (path, body) => (preview ? Promise.resolve() : api(`/player/popup/${popup.id}/${path}`, { method: 'POST', body: body || {} }).catch(() => {}));
    // the cross, the dark area around it and Escape: closed for now, it comes back later
    const dismiss = () => { post('dismiss'); finish(); };
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-dismiss]')) dismiss(); });
    post('seen');
    // "More info" goes to the page of the event; he has seen the offer, so it does not come back at once
    $('more').addEventListener('click', async (e) => {
      if (preview) return; // (the Backend's preview just opens the page)
      e.preventDefault();
      const href = $('more').href;
      await post('dismiss');
      window.location.href = href;
    });

    // the player's own data, filled in
    $('name').value = (typeof currentPlayerName === 'string' && currentPlayerName) || '';
    if (preview) { $('name').value = t('popup.previewName'); $('phone').value = '0903 111 222'; $('email').value = 'meno@priklad.sk'; }
    else {
      if (typeof currentPlayerEmail === 'string' && currentPlayerEmail) $('email').value = currentPlayerEmail;
      api('/player/session').then((me) => {
        if (!me || !wrap.isConnected) return;
        if (me.playerName && !$('name').value) $('name').value = me.playerName;
        if (me.playerEmail && !$('email').value) $('email').value = me.playerEmail;
        if (me.playerPhone && !$('phone').value) $('phone').value = me.playerPhone;
      }).catch(() => {});
    }

    const fail = (msg) => { $('error').textContent = msg; };
    wrap.querySelector('#ep-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      fail('');
      const phone = $('phone').value.trim();
      const email = $('email').value.trim();
      if (phone.replace(/\D/g, '').length < 9) return fail(t('season.regErrPhone'));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(t('season.regErrEmail'));
      if ($('partner') && $('partner').value.replace(/\s+/g, ' ').trim().length < 3) return fail(t('season.regErrPartner'));
      const button = $('yes');
      button.disabled = true;
      button.textContent = t('season.regSending');
      try {
        // (the Backend's preview shows the thank-you window with a sample answer, nothing is sent)
        const res = preview ? { name: $('name').value, paymentUrl: ev.paymentUrl || (hasFee(ev) ? '#' : '') } : await api(`/seasons/${ev.id}/registrations`, {
          method: 'POST',
          body: { name: $('name').value, phone, email, category: '', popup: true, note: '', ...($('partner') ? { partner: $('partner').value.trim() } : {}), website: '', ...(currentPlayerId ? { playerId: currentPlayerId } : {}) },
        });
        const online = res && !res.substitute && hasFee(ev) && res.paymentUrl ? `<a class="btn btn-primary btn-block" href="${esc(res.paymentUrl)}" target="_blank" rel="noopener">${esc(t('season.payOnline'))}</a>` : '';
        // the bank transfer (the IBAN of Backend > Contact, the entry fee, and a reminder to put the name of the event in the note), like on the page of the event
        let contact = null;
        if (res && !res.substitute && hasFee(ev)) contact = await api('/contact').catch(() => null);
        if (preview && (!contact || !contact.iban)) contact = { ...(contact || {}), iban: 'SK00 0000 0000 0000 0000 0000', orgName: (contact && contact.orgName) || 'Názov organizátora' }; // (a sample, when none is set yet)
        const bank = bankHtml(contact, ev, (res && res.name) || $('name').value);
        // one line says the ways to pay: online and by transfer, or only one of them
        const pay = online || bank ? `${online ? `<p>${esc(t(bank ? 'popup.payBoth' : 'season.regPayHint'))}</p>` : ''}${online}${bank}` : '';
        const here = typeof siteUrl === 'function' ? siteUrl(ev.codePath) : ev.codePath;
        wrap.querySelector('.modal').innerHTML = `
          <button type="button" class="close" data-dismiss-done aria-label="${closeLabel}">&times;</button>
          <h3>${esc(t('season.regThanks', { name: (res && res.name) || $('name').value }))}</h3>
          <p>${esc(t(res && res.substitute ? 'season.regDoneSub' : 'season.regDone'))}</p>${pay}
          <a class="btn btn-outline btn-block" href="${esc(here)}" style="margin-top:10px">${esc(t('popup.openEvent'))}</a>`;
        wrap.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
          const done = () => { b.textContent = t('season.copied'); };
          if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, done); else done();
        }));
        wrap.addEventListener('click', (e2) => { if (e2.target.closest('[data-dismiss-done]')) finish(); });
        wrap.onclick = (e2) => { if (e2.target === wrap) finish(); };
      } catch (err) {
        button.disabled = false;
        button.textContent = t('popup.yes');
        const d = err.data || {};
        if (d.code === 'ALREADY_REGISTERED') { post('dismiss'); finish(); return; } // he is in already: nothing to ask
        const msg = { REGISTRATION_CLOSED: tournament ? 'season.regClosedErrTournament' : 'season.regClosedErr', BAD_PHONE: 'season.regErrPhone', BAD_EMAIL: 'season.regErrEmail', BAD_CATEGORY: 'season.regErrCategory' }[d.code];
        fail(t(msg || 'season.regError'));
      }
    });

    // "I don't want to register": never again; then an optional "why" (one tap) for the organiser
    $('no').addEventListener('click', async () => {
      await post('decline'); // (a no-op in the preview, which still shows the next window)
      const reasons = [['NO_TIME', 'popup.reasonNoTime'], ['NOT_THIS_TIME', 'popup.reasonNotNow'], ['OTHER', 'popup.reasonOther']];
      wrap.querySelector('.modal').innerHTML = `
        <button type="button" class="close" data-dismiss-done aria-label="${closeLabel}">&times;</button>
        <h3>${esc(t('popup.declinedTitle'))}</h3>
        <p>${esc(t('popup.declinedText'))}</p>
        <div class="ep-reasons">${reasons.map(([code, key]) => `<button type="button" class="btn btn-outline" data-reason="${code}">${esc(t(key))}</button>`).join('')}</div>`;
      wrap.onclick = (e2) => { if (e2.target === wrap || e2.target.closest('[data-dismiss-done]')) finish(); };
      wrap.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', async () => { await post('reason', { reason: b.dataset.reason }); finish(); }));
    });
    setTimeout(() => { const f = $('phone'); if (f && !f.value) f.focus(); }, 50);
  }

  // on a page of the site: ask what to show to this player, and show it (not on the page of that event itself, not over another window)
  async function check() {
    if (open || window.self !== window.top) return;
    try {
      const res = await api('/player/popup/next');
      const p = res && res.popup;
      // (some windows of the page are always in it, hidden: only a visible one is in the way)
      if (!p || open || [...document.querySelectorAll('.modal-backdrop')].some((m) => getComputedStyle(m).display !== 'none')) return;
      const here = typeof currentCodePath === 'function' ? currentCodePath() : window.location.pathname;
      if (here === p.event.codePath) return; // he is looking at that event: its own button is right there
      show(p);
    } catch { /* no pop-up this time */ }
  }

  // the Backend's "Show the payment window": the thank-you window after a registration with the payment block, drawn from the data of the form (nothing is sent)
  async function showPayment(ev, name, opts = {}) {
    if (open) return;
    open = true;
    const contact = await api('/contact').catch(() => null); // (the IBAN and the name of Backend > Contact, when the event has none of its own)
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop ep-backdrop';
    const hasMoney = hasFee(ev);
    const online = hasMoney && ev.paymentUrl ? `<a class="btn btn-primary btn-block" href="${esc(ev.paymentUrl)}" target="_blank" rel="noopener">${esc(t('season.payOnline'))}</a>` : '';
    const bank = hasMoney ? bankHtml(contact, ev, name, true) : '';
    const pay = online || bank ? `${online ? `<p>${esc(t(bank ? 'popup.payBoth' : 'season.regPayHint'))}</p>` : ''}${online}${bank}` : `<p>${esc(t('season.payPreviewNone'))}</p>`;
    wrap.innerHTML = `<div class="modal ep"><button type="button" class="close" data-x aria-label="${esc(t('season.regClose'))}">&times;</button>
      ${opts.info ? `<h3>${esc(t('season.payInfoTitle'))}</h3>` : `<h3>${esc(t('season.regThanks', { name }))}</h3><p>${esc(t('season.regDone'))}</p>`}${pay}
      <button type="button" class="btn btn-outline btn-block" data-x style="margin-top:10px">${esc(t('season.regClose'))}</button></div>`;
    const close = () => { wrap.remove(); open = false; };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    wrap.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
      const done = () => { b.textContent = t('season.copied'); };
      if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, done); else done();
    }));
    document.body.appendChild(wrap);
  }

  window.BLTA_EVENT_POPUP = { check, show, showPayment };
})();
