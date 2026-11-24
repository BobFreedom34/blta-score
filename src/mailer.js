const nodemailer = require('nodemailer');
const { describeMatch } = require('./matchEngine');
const tpl = require('./emailTemplates');

let transporter = null;
function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || 'true') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

function fmtDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });
  } catch {
    return iso;
  }
}

function matchLink(match) {
  return `${process.env.PUBLIC_URL || ''}/match/${match.share_token}`;
}

// Only FRIENDLY and OTHER have their own Slovak label site-wide (see
// category.FRIENDLY/category.OTHER in i18n.js) — every other category name
// (ELITE, NEXT_GEN, ...) is used as-is in the UI too, so this mirrors that
// instead of inventing translations for names that stay in English
// everywhere else.
const CATEGORY_LABELS = { FRIENDLY: 'PRIATEĽSKÝ', OTHER: 'INÉ' };
function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category.replace('_', ' ');
}

// Matches the Slovak labels already used for these on the match page (see
// common.endReason.* in i18n.js).
const END_REASON_LABELS = { WALKOVER: 'Kontumácia', RETIREMENT: 'Skreč', UNFINISHED: 'Ponechané nedokončené' };

async function sendMatchFinishedEmail(match, player1, player2) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping match-finished email. See .env.example.');
    return false;
  }
  const state = JSON.parse(match.state);
  const score = describeMatch(state);
  const winnerName = match.winner_id === player1.id ? player1.name : match.winner_id === player2.id ? player2.name : 'Neurčený (skrečovaný/ukončený predčasne)';
  const durationMin = match.start_time && match.end_time
    ? Math.round((new Date(match.end_time) - new Date(match.start_time)) / 60000)
    : null;

  const { subject, text } = tpl.render('matchFinishedAdmin', {
    category: categoryLabel(match.category),
    player1: player1.name,
    player2: player2.name,
    winner: winnerName,
    score: `${score || '-'}${match.end_reason && END_REASON_LABELS[match.end_reason] ? ` (${END_REASON_LABELS[match.end_reason]})` : ''}`,
    location: match.location || '-',
    scheduled: fmtDate(match.scheduled_at),
    started: fmtDate(match.start_time),
    ended: fmtDate(match.end_time),
    duration: durationMin != null ? `${durationMin} min` : '',
    link: matchLink(match),
  });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject,
    text,
  });
  return true;
}

// Subscriber-facing "match started" email — someone who tapped
// "Notify me: Start" on the home page for this specific match.
async function sendMatchStartedEmailTo(match, player1, player2, toEmail) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping match-started notification.');
    return false;
  }
  const { subject, text } = tpl.render('matchStarted', {
    player1: player1.name,
    player2: player2.name,
    category: categoryLabel(match.category),
    location: match.location || '',
    link: matchLink(match),
  });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text,
  });
  return true;
}

// Subscriber-facing "match finished" email — someone who tapped
// "Notify me: Finish". Mirrors the WhatsApp share message's content.
async function sendMatchFinishedEmailTo(match, player1, player2, toEmail) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping match-finished notification.');
    return false;
  }
  const state = JSON.parse(match.state);
  const score = describeMatch(state);
  const winnerName = match.winner_id === player1.id ? player1.name : match.winner_id === player2.id ? player2.name : null;
  const reasonLabel = match.end_reason && END_REASON_LABELS[match.end_reason] ? END_REASON_LABELS[match.end_reason] : null;
  const resultText = [score, reasonLabel].filter(Boolean).join(' — ') || 'Bez výsledku';

  const { subject, text } = tpl.render('matchFinishedSubscriber', {
    player1: player1.name,
    player2: player2.name,
    result: `${resultText}${winnerName ? ` — víťaz ${winnerName}` : ''}`,
    date: fmtDate(match.start_time || match.scheduled_at),
    location: match.location || '',
    link: matchLink(match),
  });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text,
  });
  return true;
}

// Sent to whoever left an email when proposing several times/venues, once
// the other player has picked one of each (see POST /:token/respond-proposal)
// — worded neutrally since either named player could be the one who
// originally proposed the match.
async function sendProposalConfirmedEmail(match, player1, player2, toEmail) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping proposal-confirmed email.');
    return false;
  }
  const { subject, text } = tpl.render('proposalConfirmed', {
    player1: player1.name,
    player2: player2.name,
    date: fmtDate(match.scheduled_at),
    location: match.location || '-',
    link: matchLink(match),
  });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text,
  });
  return true;
}

// Sent to the other player the moment someone proposes (or counter-
// proposes) times for a match — see notifyProposalReceived in
// routes/matches.js, which fires this alongside the in-app bell
// notification. Only actually sent when the recipient has an email on
// file, same as every other "someone did something" email in this file.
async function sendProposalReceivedEmail(match, proposer, recipient) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping proposal-received email.');
    return false;
  }
  const { subject, text } = tpl.render('proposalReceived', { proposer: proposer.name, link: matchLink(match) });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: recipient.email,
    subject,
    text,
  });
  return true;
}

// Self-service login-code recovery (see POST /player/forgot-pin) — the
// link lands on the dedicated public/reset-code.html page, not anywhere
// requiring an existing session (the whole point is the player has none).
function resetCodeLink(token) {
  return `${process.env.PUBLIC_URL || ''}/reset-code?token=${token}`;
}

async function sendPinResetEmail(player, token) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping login-code reset email.');
    return false;
  }
  const { subject, text } = tpl.render('pinReset', { name: player.name, link: resetCodeLink(token) });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: player.email,
    subject,
    text,
  });
  return true;
}

// The fallback when a player has no email on file — see POST
// /player/request-admin-reset. Goes to the same admin address the
// match-finished summary email already uses, not the player.
async function sendAdminResetRequestEmail(player) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping admin reset-request email.');
    return false;
  }
  const { subject, text } = tpl.render('adminResetRequest', { name: player.name, phone: player.phone || '-' });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject,
    text,
  });
  return true;
}

// Fires on every self-service registration (see POST /player/register) —
// player here is a plain {name, phone, email, claimed} object, not a DB
// row (the route builds this from req.body directly, before/without a
// re-SELECT). claimed is true when this attached phone/email to an
// existing, admin-added roster entry that had neither yet, rather than
// creating a brand-new player — worth calling out to the admin, who'll
// likely recognize the name either way. Same admin address as the other
// admin-facing emails above.
const TENNIS_LEVEL_LABELS = { NOVICE: 'Novice – začiatočník', NEXT_GEN: 'Next Gen – mierne pokročilý', ELITE: 'Elite – veľmi pokročilý' };

async function sendNewRegistrationEmail(player) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping new-registration email.');
    return false;
  }
  const { subject, text } = tpl.render(player.claimed ? 'newRegistrationClaimed' : 'newRegistration', {
    name: player.name,
    phone: player.phone,
    email: player.email,
    level: player.tennisLevel ? (TENNIS_LEVEL_LABELS[player.tennisLevel] || player.tennisLevel) : '',
  });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject,
    text,
  });
  return true;
}

// Sent to the administrators when a player makes a club: a club is public only after the super admin approves it (Backend > Communities).
async function sendClubWaitingEmail(club) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping new-club email.');
    return false;
  }
  const mail = tpl.render('clubWaiting', {
    club: club.name,
    city: club.city || '',
    creator: club.creator || '',
    link: `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/communities-admin`,
  });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject: mail.subject,
    text: mail.text,
  });
  return true;
}

// Sent to a "looking to play" post's owner the moment another player taps
// "I want to play!" on it (see POST /availability/:id/join) — the whole
// point of that board is not having to keep checking it yourself. The
// joiner's phone/email aren't included here — the page itself already
// shows those to the owner, via this app's normal logged-in-player trust
// model (see stripPrivateFields in auth.js) — just enough to recognize who
// it is and go take a look.
async function sendPlayRequestEmail(owner, joiner, slot, message, mode = 'SINGLES') {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping play-request email.');
    return false;
  }
  const { subject, text } = tpl.render(mode === 'DOUBLES' ? 'playRequestDoubles' : 'playRequest', {
    joiner: joiner.name,
    date: fmtDate(slot),
    message: message || '',
    link: `${process.env.PUBLIC_URL || ''}${require('./seo').pageUrl('/looking-to-play', 'sk')}`,
  });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: owner.email,
    subject,
    text,
  });
  return true;
}

// Sent to the requester the moment a "looking to play" post's owner
// accepts their picked time (see POST /:id/joins/:playerId/accept) — a
// real FRIENDLY/PLANNED match already exists by the time this goes out,
// so this just points them at it rather than asking them to do anything
// further.
async function sendPlayRequestAcceptedEmail(owner, joiner, slot, matchToken) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping play-request-accepted email.');
    return false;
  }
  const { subject, text } = tpl.render('playRequestAccepted', { owner: owner.name, date: fmtDate(slot), link: `${process.env.PUBLIC_URL || ''}/match/${matchToken}` });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: joiner.email,
    subject,
    text,
  });
  return true;
}

// Sent to the player who offered to be a partner when the post's owner accepts (see POST /:id/joins/:playerId/accept for a DOUBLES post).
// No match exists yet — a doubles match needs four players — so this says the two of them are a pair for that time.
async function sendPartnerAcceptedEmail(owner, joiner, slot) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping partner-accepted email.');
    return false;
  }
  const mail = tpl.render('partnerAccepted', { owner: owner.name, date: fmtDate(slot) });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: joiner.email,
    subject: mail.subject,
    text: mail.text,
  });
  return true;
}

// Sent to the requester when a post's owner declines their picked time
// (see POST /:id/joins/:playerId/deny) — always carries the owner's own
// explanation (required server-side), so this is never just a bare "no".
async function sendPlayRequestDeniedEmail(owner, joiner, reason) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping play-request-denied email.');
    return false;
  }
  const { subject, text } = tpl.render('playRequestDenied', {
    owner: owner.name,
    reason,
    link: `${process.env.PUBLIC_URL || ''}${require('./seo').pageUrl('/looking-to-play', 'sk')}`,
  });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: joiner.email,
    subject,
    text,
  });
  return true;
}

// Sent when the daily Google Drive database backup (see src/backup.js)
// fails — the whole point of that backup is disaster recovery, so a
// silent failure there is worse than a silent failure almost anywhere
// else in the app. Same admin address as the other admin-facing emails.
// The error message itself is left untranslated (it's whatever the Drive
// API/Node threw) — only the surrounding text is Slovak.
// The phone that lies on a court of a tournament (the kiosk) is nearly out of battery and not charging: one e-mail to the organiser.
async function sendKioskBatteryLowEmail({ seasonName, courtName, level }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping kiosk battery e-mail.');
    return false;
  }
  const percent = Math.round(level * 100);
  const mail = tpl.render('kioskBatteryLow', { court: courtName, season: seasonName, percent });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject: mail.subject,
    text: mail.text,
  });
  return true;
}

// Sends one e-mail of Backend > E-mails to an address, filled with its example values (the "send a test" button); the text is the one being edited when `override` is given.
async function sendTemplateTest(key, to, override) {
  const t = getTransporter();
  if (!t) return false;
  const { subject, text } = tpl.render(key, tpl.sampleVars(key), override);
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject: `[TEST] ${subject}`, text });
  return true;
}

async function sendBackupFailedEmail(err) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping backup-failed alert email.');
    return false;
  }
  const { subject, text } = tpl.render('backupFailed', { error: err && err.message ? err.message : String(err) });

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject,
    text,
  });
  return true;
}

// A player entered a season through the season page's registration form: tells the admin who, in which category and how to
// reach them (the reply goes to the player).
// what the e-mail says about the person's account in the app
function accountNote(r) {
  if (r.account === 'created') return ' (nový hráč — v appke sme mu vytvorili účet)';
  if (r.account === 'claimed') return ' (hráč z databázy bez účtu — účet sme mu aktivovali)';
  if (r.account === 'phoneTaken') return ` (nové meno, ale telefón už patrí hráčovi ${r.phoneHolder} — účet sa nevytvoril)`;
  if (r.account === 'none') return ' (účet sa nevytvoril — telefón nie je v správnom tvare)';
  return r.isNew ? ' (nové meno — zatiaľ nie je medzi hráčmi)' : '';
}

async function sendSeasonRegistrationEmail(season, registration, total) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping season-registration email.');
    return false;
  }
  const tournament = season.kind === 'TOURNAMENT';
  const { subject, text } = tpl.render('seasonRegistration', {
    kindIn: tournament ? 'na turnaj' : 'do série',
    kindWhere: tournament ? 'v turnaji' : 'v sérii',
    season: season.name,
    name: registration.name,
    account: accountNote(registration),
    category: registration.category ? categoryLabel(registration.category) : 'zaradí admin',
    categoryTag: registration.category ? ` (${categoryLabel(registration.category)})` : '',
    substituteTag: registration.substitute ? ' (náhradník)' : '',
    phone: registration.phone,
    email: registration.email,
    note: registration.note || '',
    substituteWarning: registration.substitute ? 'POZOR: kapacita je naplnená, hráč je zaradený ako NÁHRADNÍK (nastúpi, keď sa niekto odhlási alebo zvýšite maximum).' : '',
    total,
    link: `${process.env.PUBLIC_URL || ''}${tournament ? '/tournaments-admin' : '/seasons-admin'}`,
  });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    replyTo: registration.email,
    subject,
    text,
  });
  return true;
}

// ---------------------------------------------------------------- court reservations

const SK_DAYS = ['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota'];
// '2026-10-14' -> 'streda 14.10.2026' (the date is a plain calendar day: no time zone involved)
function skDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const wd = SK_DAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return `${wd} ${d}.${m}.${y}`;
}
function skHours(n) { return `${n} ${n === 1 ? 'hodinu' : n >= 2 && n <= 4 ? 'hodiny' : 'hodín'}`; }
function reservationsLink() {
  return `${process.env.PUBLIC_URL || ''}${require('./seo').pageUrl('/reservations', 'sk')}`;
}

// The two texts of a court reservation made by a player: the confirmation to the player and the notice to the admin.
// r = { player: { name, email, phone }, court, note, day, start, end, price ('27 €' or ''), cancelHours }
function courtReservationTexts(r) {
  const when = `${skDay(r.day)}, ${r.start}–${r.end}`;
  const whenShort = `${skDay(r.day)} ${r.start}–${r.end}`;
  const first = String(r.player.name || '').trim().split(/\s+/)[0] || '';
  const cancelNote = r.cancelHours > 0
    ? `Rezerváciu môžeš zrušiť najneskôr ${skHours(r.cancelHours)} pred začiatkom.`
    : 'Rezerváciu môžeš zrušiť, kým sa daný čas nezačne.';
  return {
    player: tpl.render('courtReservationPlayer', { first, court: r.court, courtNote: r.note ? ` (${r.note})` : '', when, whenShort, price: r.price || '', cancelNote, link: reservationsLink() }),
    admin: tpl.render('courtReservationAdmin', { player: r.player.name, phone: r.player.phone || '-', email: r.player.email || '-', court: r.court, when, whenShort, price: r.price || '', link: reservationsLink() }),
  };
}

// Both e-mails of a reservation; the player's one only when the player has an e-mail on file. Never throws (a reservation must not fail
// because of an e-mail): returns { admin, player } = true when sent.
// A message from the contact window of the national page (slta.sk, "Napíš nám"): goes to the contact address of the league, the reply goes
// to the person who wrote.
async function sendContactRequestEmail({ to, name, phone, email, message, lang }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping the contact-request email (the request is kept in the database).');
    return false;
  }
  const { subject, text } = tpl.render('contactRequest', { name, email, phone: phone || '-', language: lang === 'en' ? 'EN' : 'SK', message: message || '-' });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: to || process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    replyTo: email,
    subject,
    text,
  });
  return true;
}

// A reminder to a registered player who has not paid the entry fee yet (Backend > Seasons > Registrácie > "Remind unpaid").
// The welcome e-mail after the first registration: the texts are the ones edited in Backend > Menu (src/welcomeEmail.js). `force` sends it even when it is switched off (the test button).
async function sendWelcomeEmail({ to, name, slug, lang, force }) {
  const welcome = require('./welcomeEmail');
  if (!force && !welcome.isEnabled()) return false;
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping welcome email.');
    return false;
  }
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const link = slug ? `${base}/player/${encodeURIComponent(slug)}` : base || 'https://score.blta.sk';
  const { subject, text, html } = welcome.render(lang, { name, link });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    replyTo: process.env.NOTIFY_EMAIL || undefined,
    subject,
    text,
    html,
  });
  return true;
}

async function sendPaymentReminderEmail({ to, name, seasonName, fee, paymentUrl, organiser }) {
  const t = getTransporter();
  if (!t) return false;
  const { subject, text } = tpl.render('paymentReminder', {
    name,
    season: seasonName,
    feeNote: fee ? `(${fee}) ` : '',
    paymentUrl: paymentUrl || '',
    organiser: organiser || '',
  });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    replyTo: process.env.NOTIFY_EMAIL || undefined,
    subject,
    text,
  });
  return true;
}

// The owner of the site is told when a registered player drops out (like for a registration above); never makes the drop-out fail.
async function sendSeasonUnregistrationEmail(season, registration, total) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping season-unregistration email.');
    return false;
  }
  const tournament = season.kind === 'TOURNAMENT';
  const { subject, text } = tpl.render('seasonUnregistration', {
    kindOf: tournament ? 'turnaja' : 'série',
    kindFrom: tournament ? 'z turnaja' : 'zo série',
    kindWhere: tournament ? 'v turnaji' : 'v sérii',
    season: season.name,
    name: registration.name,
    phone: registration.phone || '',
    email: registration.email || '',
    substituteNote: registration.substitute ? 'Bol to náhradník (nebol v turnaji).' : '',
    total,
    link: `${process.env.PUBLIC_URL || ''}${tournament ? '/tournaments-admin' : '/seasons-admin'}`,
  });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    replyTo: registration.email || undefined,
    subject,
    text,
  });
  return true;
}

// A substitute who got in because somebody dropped out (or the maximum was raised): he is in the tournament now.
async function sendSubstituteInEmail({ to, name, seasonName, pageUrl, organiser }) {
  const t = getTransporter();
  if (!t) return false;
  const { subject, text } = tpl.render('substituteIn', { name, season: seasonName, pageUrl: pageUrl || '', organiser: organiser || '' });
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    replyTo: process.env.NOTIFY_EMAIL || undefined,
    subject,
    text,
  });
  return true;
}

async function sendCourtReservationEmails(r) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping court-reservation emails.');
    return { admin: false, player: false };
  }
  const texts = courtReservationTexts(r);
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const sent = { admin: false, player: false };
  try {
    await t.sendMail({ from, to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER, replyTo: r.player.email || undefined, subject: texts.admin.subject, text: texts.admin.text });
    sent.admin = true;
  } catch (err) { console.error('[court reservation] admin e-mail failed:', err.message); }
  if (r.player.email) {
    try {
      await t.sendMail({ from, to: r.player.email, subject: texts.player.subject, text: texts.player.text });
      sent.player = true;
    } catch (err) { console.error('[court reservation] player e-mail failed:', err.message); }
  }
  return sent;
}

// The two texts of a cancelled reservation: the notice to the admin (when the player cancelled) and the message to the player (when the
// player cancelled: a confirmation; when the admin did: what happened). Same fields as courtReservationTexts, plus byAdmin.
function courtCancellationTexts(r) {
  const when = `${skDay(r.day)}, ${r.start}–${r.end}`;
  const whenShort = `${skDay(r.day)} ${r.start}–${r.end}`;
  const first = String(r.player.name || '').trim().split(/\s+/)[0] || '';
  const short = `${r.court}, ${whenShort}`;
  return {
    admin: tpl.render('courtCancelledAdmin', { player: r.player.name, phone: r.player.phone || '-', email: r.player.email || '-', court: r.court, short, when, whenShort, price: r.price || '', link: reservationsLink() }),
    player: tpl.render(r.byAdmin ? 'courtCancelledByAdmin' : 'courtCancelledPlayer', { first, court: r.court, short, when, whenShort, link: reservationsLink() }),
  };
}

// The e-mails of a cancelled reservation: the admin hears when the player cancelled; the player (with an e-mail on file) always hears.
// Never throws; returns { admin, player } = true when sent.
async function sendCourtCancellationEmails(r) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping court-cancellation emails.');
    return { admin: false, player: false };
  }
  const texts = courtCancellationTexts(r);
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const sent = { admin: false, player: false };
  if (!r.byAdmin) {
    try {
      await t.sendMail({ from, to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER, replyTo: r.player.email || undefined, subject: texts.admin.subject, text: texts.admin.text });
      sent.admin = true;
    } catch (err) { console.error('[court cancellation] admin e-mail failed:', err.message); }
  }
  if (r.player.email) {
    try {
      await t.sendMail({ from, to: r.player.email, subject: texts.player.subject, text: texts.player.text });
      sent.player = true;
    } catch (err) { console.error('[court cancellation] player e-mail failed:', err.message); }
  }
  return sent;
}

module.exports = {
  sendContactRequestEmail, sendPaymentReminderEmail, courtReservationTexts, sendCourtReservationEmails, courtCancellationTexts, sendCourtCancellationEmails,
  sendSeasonRegistrationEmail, sendSeasonUnregistrationEmail, sendSubstituteInEmail,
  sendMatchFinishedEmail, sendMatchStartedEmailTo, sendMatchFinishedEmailTo, sendProposalConfirmedEmail,
  sendProposalReceivedEmail,
  sendPinResetEmail, sendAdminResetRequestEmail, sendNewRegistrationEmail, sendWelcomeEmail, sendClubWaitingEmail, sendPlayRequestEmail,
  sendPlayRequestAcceptedEmail, sendPlayRequestDeniedEmail, sendPartnerAcceptedEmail, sendBackupFailedEmail, sendKioskBatteryLowEmail, sendTemplateTest,
};
