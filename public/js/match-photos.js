// Photos of a match (match page only): the photo box above the scoreboard, the "Add photo" button and the full-screen viewer.
// match.js rewrites the whole page on every render, so everything that has to survive that lives here: the photo list, the upload state
// and the viewer (a separate element on <body>, not inside #match-root). The markup of the box is rebuilt by matchPhotosHtml() each render.
let photoState = { enabled: false, max: 5, canAdd: false, photos: [] };
let photoToken = null;
let photoOnChange = () => {};
let photoUploading = false;
let photoLoadSeq = 0; // a slow answer must not overwrite a newer one
let photoViewerId = null; // id of the photo the viewer shows; null while it is closed
let photoViewerIndex = 0;
// Pictures that fail to load: one retry after a few seconds (with a cache-busting parameter), then the picture is given up on and never
// rendered again. Kept here (by picture URL) because render() rebuilds the page's markup all the time, so a loop of "render, fail,
// render, fail" must not be possible. Entry: { issued: retry started, failed: gave up, useUrl: the URL that is rendered from now on }.
const PHOTO_RETRY_MS = 3000;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']; // what the server accepts
const photoImgState = {};

function photoImgSrc(key) {
  const st = photoImgState[key];
  return st && st.useUrl ? st.useUrl : key;
}

function photoImgFailed(key) {
  return !!(photoImgState[key] && photoImgState[key].failed);
}

function onPhotoImageError(key) {
  let st = photoImgState[key];
  if (!st) {
    st = { issued: false, failed: false, useUrl: null };
    photoImgState[key] = st;
    setTimeout(() => {
      st.issued = true;
      st.useUrl = `${key}${key.includes('?') ? '&' : '?'}r=${Date.now()}`;
      // the page may have been re-rendered meanwhile, so look the pictures up now instead of keeping the old elements
      document.querySelectorAll('img[data-photo-key]').forEach((img) => { if (img.dataset.photoKey === key) img.src = st.useUrl; });
    }, PHOTO_RETRY_MS);
    return;
  }
  // an error while the retry is still waiting (e.g. a freshly re-rendered copy of the picture) changes nothing
  if (!st.issued || st.failed) return;
  st.failed = true;
  photoOnChange();
  if (photoViewerEl()) renderPhotoViewer();
}

// Watches the <img data-photo-key> pictures inside `container`. A picture may already have failed before the listener could be
// attached (the markup was only just built), so that case is handled here as well.
function watchPhotoImages(container) {
  container.querySelectorAll('img[data-photo-key]').forEach((img) => {
    const key = img.dataset.photoKey;
    img.addEventListener('error', () => onPhotoImageError(key));
    if (img.complete && !img.naturalWidth) onPhotoImageError(key);
  });
}

function photoImgTag(key, alt) {
  return `<img src="${escapeHtml(photoImgSrc(key))}" data-photo-key="${escapeHtml(key)}" alt="${escapeHtml(alt || '')}">`;
}

// "+N photos" needs the real Slovak plural forms (1 / 2-4 / 5+), like attemptsWord in common.js.
function photosWord(n) {
  if (currentLang === 'sk') {
    if (n === 1) return 'fotka';
    if (n >= 2 && n <= 4) return 'fotky';
    return 'fotiek';
  }
  return n === 1 ? 'photo' : 'photos';
}

// Fills the module state from the server. Never throws: when the photos cannot be loaded the page simply shows nothing new.
async function loadMatchPhotos(token) {
  photoToken = token;
  const seq = ++photoLoadSeq;
  let next = { enabled: false, max: 5, canAdd: false, photos: [] };
  try {
    const data = await api(`/matches/${token}/photos`);
    if (data && data.enabled) next = { enabled: true, max: data.max || 5, canAdd: !!data.canAdd, photos: data.photos || [] };
  } catch { /* photos are best-effort */ }
  if (seq !== photoLoadSeq) return;
  photoState = next;
  syncPhotoViewer();
}

function matchPhotosHtml() {
  const { enabled, max, canAdd, photos } = photoState;
  if (!enabled) return '';
  if (!photos.length && !canAdd && !photoUploading) return '';
  // the first photo that loads is the cover; when none does, the box is hidden — unless somebody can still add or remove a photo there,
  // then an empty (broken) box stays so that the viewer can be opened and the dead photo removed
  const coverIndex = photos.findIndex((p) => !photoImgFailed(p.url));
  const keepBroken = coverIndex < 0 && (canAdd || photoUploading || photos.some((p) => p.canRemove));
  const box = photos.length && (coverIndex >= 0 || keepBroken) ? `
    <div class="match-photo-box${coverIndex < 0 ? ' is-broken' : ''}" id="match-photo-box" data-index="${Math.max(coverIndex, 0)}" role="button" tabindex="0" aria-label="${escapeHtml(t('match.photoOpen'))}">
      ${coverIndex >= 0 ? photoImgTag(photos[coverIndex].url) : `<span class="match-photo-broken">${escapeHtml(t('match.photoBroken'))}</span>`}
      ${photos.length > 1 ? `<span class="match-photo-more">${escapeHtml(t('match.photoMore', { n: photos.length - 1, word: photosWord(photos.length - 1) }))}</span>` : ''}
    </div>` : '';
  const addLabel = photoUploading ? t('match.photoUploading') : t('match.photoAdd', { n: photos.length, max });
  const add = (canAdd || photoUploading)
    ? `<button type="button" class="btn btn-dark match-photo-add" id="match-photo-add"${photoUploading ? ' disabled' : ''}>${escapeHtml(addLabel)}</button>`
    : '';
  return box || add ? `<div class="match-photos">${box}${add}</div>` : '';
}

// Called after every render() once the markup is in the page. onChange re-renders the match page.
function bindMatchPhotos(token, onChange) {
  photoToken = token;
  photoOnChange = onChange;
  const box = document.getElementById('match-photo-box');
  if (box) {
    const open = () => openPhotoViewer(Number(box.dataset.index) || 0);
    box.addEventListener('click', open);
    watchPhotoImages(box);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }
  const addBtn = document.getElementById('match-photo-add');
  if (addBtn) addBtn.addEventListener('click', () => { if (!photoUploading) askPhotoSource(); });
}

// A phone or tablet (touch) asks first: take a photo now, or choose one that is on the phone. A computer opens the file window at once.
function askPhotoSource() {
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!touch) { ensurePhotoFileInput(false).click(); return; }
  if (document.getElementById('photo-source-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'photo-source-modal';
  modal.className = 'modal-backdrop';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:340px">
      <button type="button" class="btn btn-primary btn-block" data-take>📷 ${escapeHtml(t('match.photoTake'))}</button>
      <button type="button" class="btn btn-outline btn-block" data-choose style="margin-top:8px">🖼 ${escapeHtml(t('match.photoChoose'))}</button>
      <button type="button" class="btn btn-outline btn-block" data-cancel style="margin-top:8px">${escapeHtml(t('common.cancel'))}</button>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-cancel]')) { close(); return; }
    if (e.target.closest('[data-take]')) { close(); ensurePhotoFileInput(true).click(); return; }
    if (e.target.closest('[data-choose]')) { close(); ensurePhotoFileInput(false).click(); }
  });
}

// Two file inputs that live on <body> for good (one opens the camera, one the photos of the phone): the page markup is replaced all the time (every
// score update), and an input that is removed from the page while the phone's picker is open would never report the chosen photo. data-no-library: the
// "choose from the picture library" window of the backend (common.js) is not for photos of a match.
const photoInputs = {};
function ensurePhotoFileInput(camera) {
  const key = camera ? 'camera' : 'gallery';
  if (photoInputs[key]) return photoInputs[key];
  const input = document.createElement('input');
  input.type = 'file';
  if (camera) {
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment'); // the back camera of the phone
  } else {
    input.accept = PHOTO_TYPES.join(','); // so a phone that keeps its photos as HEIC hands over a JPEG
  }
  input.dataset.noLibrary = '1';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = ''; // so choosing the same photo again still fires "change"
    if (file) uploadMatchPhoto(file);
  });
  document.body.appendChild(input);
  photoInputs[key] = input;
  return input;
}

// Decodes the picture (honouring the EXIF rotation) into something drawable; resolves with { source, width, height, release() }.
function decodePhotoFile(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bmp) => ({ source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

// Shrinks a photo in the browser before it is sent (a phone photo is several MB; 1800 px on the long side is plenty for the page):
// canvas -> JPEG. A picture that can be decoded is always re-encoded (shrunk or not), which also drops its EXIF data, GPS position
// included. If it cannot be decoded here the original file is returned; uploadMatchPhoto only sends that when it is a type the server takes.
async function resizeImageForUpload(file, maxSide = 1800, quality = 0.85) {
  let decoded = null;
  try {
    decoded = await decodePhotoFile(file);
    const { source, width, height } = decoded;
    if (!width || !height) return file;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
    if (!blob) return file;
    return blob;
  } catch {
    return file;
  } finally {
    if (decoded) decoded.release();
  }
}

async function uploadMatchPhoto(file) {
  if (photoUploading) return;
  const token = photoToken;
  photoUploading = true;
  photoOnChange();
  try {
    const blob = await resizeImageForUpload(file);
    // could not be decoded here and is not a type the server takes (HEIC, GIF…): say so instead of sending it to be refused
    if (blob === file && !PHOTO_TYPES.includes(file.type)) throw new Error(t('match.photoUnsupported'));
    const form = new FormData();
    form.append('photo', blob, 'photo.jpg');
    const res = await fetch(`/api/matches/${token}/photos`, { method: 'POST', body: form });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  } catch (err) {
    toast(err.message);
  }
  photoUploading = false;
  await loadMatchPhotos(token);
  photoOnChange();
}

async function removeMatchPhoto(photo) {
  if (!confirm(t('match.photoRemoveConfirm'))) return;
  const token = photoToken;
  try {
    await api(`/matches/${token}/photos/${photo.id}`, { method: 'DELETE' });
  } catch (err) {
    toast(err.message);
  }
  // reload either way: after a failure (e.g. somebody else already removed it) the list still has to be right
  await loadMatchPhotos(token);
  photoOnChange();
}

// ---------- the full-screen viewer ----------

function photoViewerEl() { return document.getElementById('photo-viewer'); }

function openPhotoViewer(startIndex) {
  const photos = photoState.photos;
  if (!photos.length) return;
  photoViewerIndex = Math.min(Math.max(0, startIndex || 0), photos.length - 1);
  photoViewerId = photos[photoViewerIndex].id;
  let el = photoViewerEl();
  if (!el) {
    el = document.createElement('div');
    el.id = 'photo-viewer';
    el.className = 'photo-viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onPhotoViewerKey);
    bindPhotoViewerSwipe(el);
  }
  renderPhotoViewer();
  const closeBtn = el.querySelector('.photo-viewer-close');
  if (closeBtn) closeBtn.focus();
}

function closePhotoViewer() {
  const el = photoViewerEl();
  if (el) el.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onPhotoViewerKey);
  photoViewerId = null;
}

function stepPhotoViewer(delta) {
  const n = photoState.photos.length;
  if (n < 2) return;
  photoViewerIndex = (photoViewerIndex + delta + n) % n;
  photoViewerId = photoState.photos[photoViewerIndex].id;
  renderPhotoViewer();
}

function onPhotoViewerKey(e) {
  if (e.key === 'Escape') closePhotoViewer();
  else if (e.key === 'ArrowLeft') stepPhotoViewer(-1);
  else if (e.key === 'ArrowRight') stepPhotoViewer(1);
}

// Swipe left/right on the picture (phones). Mostly-vertical movement is left alone, so it never fights with scrolling gestures.
function bindPhotoViewerSwipe(el) {
  let startX = 0;
  let startY = 0;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!e.changedTouches.length || !e.target.closest('.photo-viewer-stage')) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepPhotoViewer(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function renderPhotoViewer() {
  const el = photoViewerEl();
  const photos = photoState.photos;
  if (!el) return;
  if (!photos.length) { closePhotoViewer(); return; }
  const photo = photos[photoViewerIndex];
  const caption = photo.addedBy ? t('match.photoAddedBy', { name: photo.addedBy }) : t('match.photoAddedByAdmin');
  el.innerHTML = `
    <div class="photo-viewer-top">
      <span class="photo-viewer-count">${photoViewerIndex + 1} / ${photos.length}</span>
      <button type="button" class="photo-viewer-close" aria-label="${escapeHtml(t('match.photoClose'))}">&#10005;</button>
    </div>
    <div class="photo-viewer-stage">
      ${photoImgFailed(photo.url) ? `<div class="photo-viewer-broken">${escapeHtml(t('match.photoBroken'))}</div>` : photoImgTag(photo.url, caption)}
      ${photos.length > 1 ? `
        <button type="button" class="photo-viewer-arrow prev" aria-label="&lsaquo;">&lsaquo;</button>
        <button type="button" class="photo-viewer-arrow next" aria-label="&rsaquo;">&rsaquo;</button>` : ''}
    </div>
    ${photos.length > 1 ? `<div class="photo-viewer-strip">${photos.map((p, i) => `
      <button type="button" class="photo-viewer-thumb${i === photoViewerIndex ? ' on' : ''}" data-index="${i}">${photoImgFailed(p.thumbUrl) ? '' : photoImgTag(p.thumbUrl)}</button>`).join('')}</div>` : ''}
    <div class="photo-viewer-caption">
      <span>${escapeHtml(caption)}</span>
      ${photo.canRemove ? `<button type="button" class="photo-viewer-remove">${escapeHtml(t('match.photoRemove'))}</button>` : ''}
    </div>`;
  watchPhotoImages(el);
  el.querySelector('.photo-viewer-close').addEventListener('click', closePhotoViewer);
  // a tap on the empty dark area (not on the picture, arrows or buttons) closes the viewer
  el.onclick = (e) => { if (e.target === el || e.target.classList.contains('photo-viewer-stage')) closePhotoViewer(); };
  const prev = el.querySelector('.photo-viewer-arrow.prev');
  if (prev) prev.addEventListener('click', () => stepPhotoViewer(-1));
  const next = el.querySelector('.photo-viewer-arrow.next');
  if (next) next.addEventListener('click', () => stepPhotoViewer(1));
  el.querySelectorAll('.photo-viewer-thumb').forEach((btn) => btn.addEventListener('click', () => {
    photoViewerIndex = Number(btn.dataset.index);
    photoViewerId = photoState.photos[photoViewerIndex].id;
    renderPhotoViewer();
  }));
  const removeBtn = el.querySelector('.photo-viewer-remove');
  if (removeBtn) removeBtn.addEventListener('click', () => removeMatchPhoto(photo));
}

// The list changed under an open viewer (somebody added/removed a photo): keep showing the same photo if it is still there,
// otherwise move to the nearest one, and close when none are left — the viewer never shows a photo that no longer exists.
function syncPhotoViewer() {
  if (photoViewerId === null || !photoViewerEl()) return;
  const photos = photoState.photos;
  if (!photos.length) { closePhotoViewer(); return; }
  const idx = photos.findIndex((p) => p.id === photoViewerId);
  if (idx >= 0) photoViewerIndex = idx;
  else photoViewerIndex = Math.min(photoViewerIndex, photos.length - 1);
  photoViewerId = photos[photoViewerIndex].id;
  renderPhotoViewer();
}
