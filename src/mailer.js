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

module.exports = { sendMatchFinishedEmail, sendMatchStartedEmailTo, sendMatchFinishedEmailTo };
