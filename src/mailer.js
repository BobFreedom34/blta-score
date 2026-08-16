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

async function sendMatchFinishedEmail(match, player1, player2) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping match-finished email. See .env.example.');
    return false;
  }
  const state = JSON.parse(match.state);
  const score = describeMatch(state);
  const winnerName = state.winner === 1 ? player1.name : state.winner === 2 ? player2.name : 'Not determined (retired/ended early)';
  const durationMin = match.start_time && match.end_time
    ? Math.round((new Date(match.end_time) - new Date(match.start_time)) / 60000)
    : null;

  const baseUrl = process.env.PUBLIC_URL || '';
  const link = `${baseUrl}/match/${match.id}`;

  const subject = `Match finished: ${player1.name} vs ${player2.name} (${match.category.replace('_', ' ')})`;
  const text = [
    `Category: ${match.category.replace('_', ' ')}`,
    `Players: ${player1.name} vs ${player2.name}`,
    `Winner: ${winnerName}`,
    `Score: ${score || '-'}`,
    `Location: ${match.location || '-'}`,
    `Scheduled: ${fmtDate(match.scheduled_at)}`,
    `Started: ${fmtDate(match.start_time)}`,
    `Finished: ${fmtDate(match.end_time)}`,
    durationMin != null ? `Duration: ${durationMin} min` : null,
    `Link: ${link}`,
  ].filter(Boolean).join('\n');

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
    subject,
    text,
  });
  return true;
}

module.exports = { sendMatchFinishedEmail };
