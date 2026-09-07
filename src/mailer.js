const nodemailer = require('nodemailer');
const { describeMatch } = require('./matchEngine');

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

// Only FRIENDLY has its own Slovak label site-wide (see category.FRIENDLY in
// i18n.js) — every other category name (ELITE, NEXT_GEN, ...) is used as-is
// in the UI too, so this mirrors that instead of inventing translations for
// names that stay in English everywhere else.
const CATEGORY_LABELS = { FRIENDLY: 'PRIATEĽSKÝ' };
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

  const subject = `Zápas ukončený: ${player1.name} vs ${player2.name} (${categoryLabel(match.category)})`;
  const text = [
    `Kategória: ${categoryLabel(match.category)}`,
    `Hráči: ${player1.name} vs ${player2.name}`,
    `Víťaz: ${winnerName}`,
    `Skóre: ${score || '-'}${match.end_reason && END_REASON_LABELS[match.end_reason] ? ` (${END_REASON_LABELS[match.end_reason]})` : ''}`,
    `Miesto: ${match.location || '-'}`,
    `Naplánované: ${fmtDate(match.scheduled_at)}`,
    `Začiatok: ${fmtDate(match.start_time)}`,
    `Koniec: ${fmtDate(match.end_time)}`,
    durationMin != null ? `Trvanie: ${durationMin} min` : null,
    `Odkaz: ${matchLink(match)}`,
  ].filter(Boolean).join('\n');

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
  const subject = `Zápas začal: ${player1.name} vs ${player2.name}`;
  const lines = [
    `${player1.name} vs ${player2.name} práve začal!`,
    `Kategória: ${categoryLabel(match.category)}`,
  ];
  if (match.location) lines.push(`Miesto: ${match.location}`);
  lines.push(`Sledovať naživo: ${matchLink(match)}`);

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text: lines.join('\n'),
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

  const subject = `Zápas skončil: ${player1.name} vs ${player2.name}`;
  const lines = [
    `${player1.name} vs ${player2.name}`,
    `Výsledok: ${resultText}${winnerName ? ` — víťaz ${winnerName}` : ''}`,
    `Dátum: ${fmtDate(match.start_time || match.scheduled_at)}`,
  ];
  if (match.location) lines.push(`Miesto: ${match.location}`);
  lines.push(`Odkaz: ${matchLink(match)}`);

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text: lines.join('\n'),
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
  const subject = `Termín potvrdený: ${player1.name} vs ${player2.name}`;
  const lines = [
    `Pre zápas, ktorý si navrhol, bol vybraný termín: ${player1.name} vs ${player2.name}.`,
    `Kedy: ${fmtDate(match.scheduled_at)}`,
    `Kde: ${match.location || '-'}`,
    `Odkaz: ${matchLink(match)}`,
  ];

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text: lines.join('\n'),
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
  const subject = `${proposer.name} ti navrhol termíny na hru!`;
  const lines = [
    `${proposer.name} ti navrhol termíny na váš zápas na Tennis SCORE.`,
    `Vyber si ten, ktorý ti vyhovuje, tu: ${matchLink(match)}`,
  ];

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: recipient.email,
    subject,
    text: lines.join('\n'),
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
  const subject = 'Obnovenie prihlasovacieho kódu pre BLTA Score';
  const text = [
    `Ahoj ${player.name},`,
    '',
    'Niekto (dúfajme, že ty) požiadal o obnovenie tvojho prihlasovacieho kódu pre BLTA Score.',
    `Nastav si nový tu: ${resetCodeLink(token)}`,
    '',
    'Tento odkaz platí 1 hodinu. Ak si o to nežiadal, tento e-mail jednoducho ignoruj.',
  ].join('\n');

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
  const subject = `Žiadosť o reset prihlasovacieho kódu: ${player.name}`;
  const text = [
    `${player.name} (telefón ${player.phone || '-'}) požiadal o reset svojho prihlasovacieho kódu pre BLTA Score.`,
    'Nemá uvedený e-mail, takže mu nie je možné poslať odkaz na samoobslužný reset.',
    'Resetuj ho z jeho profilu (Upraviť profil → Resetovať prihlasovací kód) po tom, čo si overíš, že je to naozaj on.',
  ].join('\n');

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
async function sendNewRegistrationEmail(player) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping new-registration email.');
    return false;
  }
  const subject = `Nová registrácia hráča: ${player.name}`;
  const text = [
    player.claimed
      ? `${player.name} si práve priradil svoj existujúci profil hráča na BLTA Score (doteraz nemal uvedený telefón ani e-mail):`
      : 'Nový hráč sa práve zaregistroval na BLTA Score:',
    `Meno: ${player.name}`,
    `Telefón: ${player.phone}`,
    `E-mail: ${player.email}`,
  ].join('\n');

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject,
    text,
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
async function sendPlayRequestEmail(owner, joiner, slot, message) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping play-request email.');
    return false;
  }
  const subject = `${joiner.name} chce s tebou hrať!`;
  const lines = [
    `${joiner.name} videl tvoj príspevok „Chcem hrať“ na Tennis SCORE a vybral si jeden z tvojich voľných termínov na priateľský zápas:`,
    `Kedy: ${fmtDate(slot)}`,
  ];
  if (message) lines.push(`Jeho odkaz: "${message}"`);
  lines.push(`Pozri si to tu: ${process.env.PUBLIC_URL || ''}/looking-to-play`);

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: owner.email,
    subject,
    text: lines.join('\n'),
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
  const subject = `${owner.name} prijal tvoj termín na hru!`;
  const lines = [
    `${owner.name} prijal termín, ktorý si si vybral na Tennis SCORE — máte dohodnutý priateľský zápas.`,
    `Kedy: ${fmtDate(slot)}`,
    `Zápas: ${process.env.PUBLIC_URL || ''}/match/${matchToken}`,
  ];

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: joiner.email,
    subject,
    text: lines.join('\n'),
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
  const subject = `${owner.name} ti v tomto termíne nemôže vyhovieť`;
  const lines = [
    `${owner.name} nemohol prijať termín, ktorý si si vybral na Tennis SCORE.`,
    `Jeho poznámka: "${reason}"`,
    `Pozri si jeho ďalšie voľné termíny: ${process.env.PUBLIC_URL || ''}/looking-to-play`,
  ];

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: joiner.email,
    subject,
    text: lines.join('\n'),
  });
  return true;
}

// Sent when the daily Google Drive database backup (see src/backup.js)
// fails — the whole point of that backup is disaster recovery, so a
// silent failure there is worse than a silent failure almost anywhere
// else in the app. Same admin address as the other admin-facing emails.
// The error message itself is left untranslated (it's whatever the Drive
// API/Node threw) — only the surrounding text is Slovak.
async function sendBackupFailedEmail(err) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping backup-failed alert email.');
    return false;
  }
  const subject = 'BLTA Score: záloha databázy zlyhala';
  const text = [
    'Dnešná automatická záloha databázy BLTA Score na Google Drive zlyhala:',
    '',
    err && err.message ? err.message : String(err),
    '',
    'Samotná stránka nie je ovplyvnená — znamená to len, že dnešná záloha mimo servera sa neuskutočnila. Kompletnú chybu nájdeš v Render logoch.',
  ].join('\n');

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject,
    text,
  });
  return true;
}

module.exports = {
  sendMatchFinishedEmail, sendMatchStartedEmailTo, sendMatchFinishedEmailTo, sendProposalConfirmedEmail,
  sendProposalReceivedEmail,
  sendPinResetEmail, sendAdminResetRequestEmail, sendNewRegistrationEmail, sendPlayRequestEmail,
  sendPlayRequestAcceptedEmail, sendPlayRequestDeniedEmail, sendBackupFailedEmail,
};
