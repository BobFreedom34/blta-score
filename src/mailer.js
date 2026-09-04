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

const END_REASON_LABELS = { WALKOVER: 'Walkover', RETIREMENT: 'Retirement', UNFINISHED: 'Left unfinished' };

async function sendMatchFinishedEmail(match, player1, player2) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping match-finished email. See .env.example.');
    return false;
  }
  const state = JSON.parse(match.state);
  const score = describeMatch(state);
  const winnerName = match.winner_id === player1.id ? player1.name : match.winner_id === player2.id ? player2.name : 'Not determined (retired/ended early)';
  const durationMin = match.start_time && match.end_time
    ? Math.round((new Date(match.end_time) - new Date(match.start_time)) / 60000)
    : null;

  const subject = `Match finished: ${player1.name} vs ${player2.name} (${match.category.replace('_', ' ')})`;
  const text = [
    `Category: ${match.category.replace('_', ' ')}`,
    `Players: ${player1.name} vs ${player2.name}`,
    `Winner: ${winnerName}`,
    `Score: ${score || '-'}${match.end_reason && END_REASON_LABELS[match.end_reason] ? ` (${END_REASON_LABELS[match.end_reason]})` : ''}`,
    `Location: ${match.location || '-'}`,
    `Scheduled: ${fmtDate(match.scheduled_at)}`,
    `Started: ${fmtDate(match.start_time)}`,
    `Finished: ${fmtDate(match.end_time)}`,
    durationMin != null ? `Duration: ${durationMin} min` : null,
    `Link: ${matchLink(match)}`,
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
  const subject = `Match started: ${player1.name} vs ${player2.name}`;
  const lines = [
    `${player1.name} vs ${player2.name} just started!`,
    `Category: ${match.category.replace('_', ' ')}`,
  ];
  if (match.location) lines.push(`Location: ${match.location}`);
  lines.push(`Watch live: ${matchLink(match)}`);

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
  const resultText = [score, reasonLabel].filter(Boolean).join(' — ') || 'No result';

  const subject = `Match finished: ${player1.name} vs ${player2.name}`;
  const lines = [
    `${player1.name} vs ${player2.name}`,
    `Result: ${resultText}${winnerName ? ` — ${winnerName} wins` : ''}`,
    `Date: ${fmtDate(match.start_time || match.scheduled_at)}`,
  ];
  if (match.location) lines.push(`Location: ${match.location}`);
  lines.push(`Link: ${matchLink(match)}`);

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
  const subject = `Time confirmed: ${player1.name} vs ${player2.name}`;
  const lines = [
    `A time has been picked for the match you proposed: ${player1.name} vs ${player2.name}.`,
    `When: ${fmtDate(match.scheduled_at)}`,
    `Where: ${match.location || '-'}`,
    `Link: ${matchLink(match)}`,
  ];

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
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
  const subject = 'Reset your BLTA Score login code';
  const text = [
    `Hi ${player.name},`,
    '',
    'Someone (hopefully you) requested to reset your BLTA Score login code.',
    `Set a new one here: ${resetCodeLink(token)}`,
    '',
    "This link works for 1 hour. If you didn't request this, you can just ignore this email.",
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
  const subject = `Login code reset requested: ${player.name}`;
  const text = [
    `${player.name} (phone ${player.phone || '-'}) has requested their BLTA Score login code be reset.`,
    "They have no email on file, so there's no self-service link to send them.",
    'Reset it from their profile page (Upraviť profil → Resetovať prihlasovací kód) once you\'ve confirmed it\'s really them.',
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
  const subject = `New player registration: ${player.name}`;
  const text = [
    player.claimed
      ? `${player.name} just claimed their existing player entry on BLTA Score (it had no phone/email on file before now):`
      : 'A new player just registered themselves on BLTA Score:',
    `Name: ${player.name}`,
    `Phone: ${player.phone}`,
    `Email: ${player.email}`,
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
async function sendPlayRequestEmail(owner, joiner, message) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping play-request email.');
    return false;
  }
  const subject = `${joiner.name} wants to play with you!`;
  const lines = [
    `${joiner.name} saw your "Looking to play" post on Tennis SCORE and wants to play a friendly match with you.`,
  ];
  if (message) lines.push(`Their message: "${message}"`);
  lines.push(`See it here: ${process.env.PUBLIC_URL || ''}/looking-to-play`);

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: owner.email,
    subject,
    text: lines.join('\n'),
  });
  return true;
}

module.exports = {
  sendMatchFinishedEmail, sendMatchStartedEmailTo, sendMatchFinishedEmailTo, sendProposalConfirmedEmail,
  sendPinResetEmail, sendAdminResetRequestEmail, sendNewRegistrationEmail, sendPlayRequestEmail,
};
