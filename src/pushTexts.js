// The wording of the automatic pushes (src/playerPush.js). It follows the bell (notif.* in public/js/i18n.js) so a push and the bell row it
// came from read the same. Pure: no database, so it can be checked on its own. `url` is the canonical address; playerPush localizes it.
const BODY_MAX = 120;

const clip = (text) => {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > BODY_MAX ? `${s.slice(0, BODY_MAX - 1).trimEnd()}…` : s;
};
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, k) => (values[k] == null ? '' : String(values[k])));

const WORDING = {
  CHAT: { sk: '💬 Nová správa od {name}', en: '💬 New message from {name}' },
  PLAY_REQUEST: { sk: '👋 {name} chce s tebou hrať', en: '👋 {name} wants to play with you' },
  PARTNER_REQUEST: { sk: '👋 {name} by s tebou hral štvorhru ako partner', en: '👋 {name} offers to be your doubles partner' },
  PROPOSAL_RECEIVED: { sk: '📅 {name} ti navrhol termíny', en: '📅 {name} proposed times to you' },
  PROPOSAL_CONFIRMED: { sk: '✅ {name} potvrdil termín zápasu', en: '✅ {name} confirmed a time' },
  PHOTO: { sk: '📷 {name} pridal fotku k tvojmu zápasu', en: '📷 {name} added a photo to your match' },
  RANKING_UP: { sk: '📈 V BLTA rebríčku si sa posunul o {amount} hore — teraz si na {rank}. mieste', en: '📈 You climbed {amount} places in the BLTA ranking — now #{rank}' },
  RANKING_DOWN: { sk: '📉 V BLTA rebríčku si klesol o {amount} dole — teraz si na {rank}. mieste', en: '📉 You dropped {amount} places in the BLTA ranking — now #{rank}' },
  POST: { sk: '📢 {org}: nová novinka od {name}', en: '📢 {org}: a new post from {name}' },
  REACTION: { sk: '{emoji} {name} reagoval na tvoju novinku v {org}', en: '{emoji} {name} reacted to your post in {org}' },
  COMMENT: { sk: '💬 {name} komentoval tvoju novinku v {org}', en: '💬 {name} commented on your post in {org}' },
  APPROVAL: { sk: '🏟️ Nový klub čaká na schválenie: {org}', en: '🏟️ A new club waits for your approval: {org}' },
  INVITE: { sk: '👥 {name} ťa pozýva: {org}', en: '👥 {name} invites you to {org}' },
  BADGE: { sk: '🏅 Získal si odznak: {badge}', en: '🏅 You earned a badge: {badge}' },
  BADGE_REMINDER: { sk: '📅 Blíži sa: {badge}', en: '📅 Coming up: {badge}' },
};
const BADGE_REMINDER_BODY = { sk: 'Nenechaj si ho ujsť!', en: "Don't let it get away!" };
const SOMEONE = { sk: 'Niekto', en: 'Someone' };

// kind: DM | CHAT | PLAY_REQUEST | PARTNER_REQUEST | PROPOSAL_RECEIVED | PROPOSAL_CONFIRMED | PHOTO | RANKING_UP | RANKING_DOWN | BADGE | BADGE_REMINDER
// Returns { title, body, url, tag }. An unknown language reads as Slovak (the site's first language).
function build(kind, data = {}, lang = 'sk') {
  const l = lang === 'en' ? 'en' : 'sk';
  const name = data.fromName || data.name || SOMEONE[l];
  const matchUrl = data.matchToken ? `/match/${encodeURIComponent(data.matchToken)}` : '/matches';
  switch (kind) {
    // a direct message looks like a message: the sender is the title, the text the body
    case 'DM': return { title: clip(name), body: clip(data.body), url: '/messages', tag: `dm-${data.conversationId || 'x'}` };
    case 'CHAT': return { title: fill(WORDING.CHAT[l], { name }), body: clip(data.body), url: matchUrl, tag: `chat-${data.matchToken || 'x'}` };
    case 'PLAY_REQUEST':
    case 'PARTNER_REQUEST': {
      const k = kind === 'PARTNER_REQUEST' || data.mode === 'DOUBLES' ? 'PARTNER_REQUEST' : 'PLAY_REQUEST';
      return { title: fill(WORDING[k][l], { name }), body: clip(data.message), url: '/looking-to-play', tag: 'play-request' };
    }
    case 'PROPOSAL_RECEIVED':
    case 'PROPOSAL_CONFIRMED':
      return { title: fill(WORDING[kind][l], { name }), body: '', url: matchUrl, tag: `proposal-${data.matchToken || 'x'}` };
    case 'POST': return { title: fill(WORDING.POST[l], { name, org: data.orgName || '' }), body: clip(data.body), url: data.orgSlug ? `/community/${encodeURIComponent(data.orgSlug)}` : '/communities', tag: `post-${data.postId || 'x'}` };
    case 'REACTION': return { title: fill(WORDING.REACTION[l], { name, org: data.orgName || '', emoji: data.emoji || '' }), body: '', url: data.orgSlug ? `/community/${encodeURIComponent(data.orgSlug)}` : '/communities', tag: `reaction-${data.postId || 'x'}` };
    case 'COMMENT': return { title: fill(WORDING.COMMENT[l], { name, org: data.orgName || '' }), body: clip(data.body), url: data.orgSlug ? `/community/${encodeURIComponent(data.orgSlug)}` : '/communities', tag: `comment-${data.postId || 'x'}` };
    case 'APPROVAL': return { title: fill(WORDING.APPROVAL[l], { org: data.orgName || '' }), body: data.fromName ? `${data.fromName}` : '', url: '/messages', tag: 'approval' };
    case 'INVITE': return { title: fill(WORDING.INVITE[l], { name, org: data.orgName || '' }), body: '', url: '/messages', tag: 'invite' };
    case 'PHOTO': return { title: fill(WORDING.PHOTO[l], { name }), body: '', url: matchUrl, tag: `photo-${data.matchToken || 'x'}` };
    case 'RANKING_UP':
    case 'RANKING_DOWN': return { title: fill(WORDING[kind][l], data), body: '', url: '/rankings', tag: 'ranking' };
    case 'BADGE': return { title: fill(WORDING.BADGE[l], { badge: data.badge }), body: clip(data.description), url: data.playerPath || '/', tag: 'badge' };
    case 'BADGE_REMINDER': return { title: fill(WORDING.BADGE_REMINDER[l], { badge: data.badge }), body: BADGE_REMINDER_BODY[l], url: data.playerPath || '/', tag: 'badge-reminder' };
    default: throw new Error(`Unknown push kind: ${kind}`);
  }
}

module.exports = { build, clip };
