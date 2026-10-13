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
let photoFileInput = null;

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
  const first = photos[0];
  const box = first ? `
    <div class="match-photo-box" id="match-photo-box" role="button" tabindex="0" aria-label="${escapeHtml(t('match.photoOpen'))}">
      <img src="${escapeHtml(first.url)}" alt="" decoding="async">
      ${photos.length > 1 ? `<span class="match-photo-more">${escapeHtml(t('match.photoMore', { n: photos.length - 1, word: photosWord(photos.length - 1) }))}</span>` : ''}
    </div>` : '';
  const addLabel = photoUploading ? t('match.photoUploading') : t('match.photoAdd', { n: photos.length, max });
  const add = (canAdd || photoUploading)
    ? `<button type="button" class="btn btn-dark match-photo-add" id="match-photo-add"${photoUploading ? ' disabled' : ''}>${escapeHtml(addLabel)}</button>`
    : '';
  return `<div class="match-photos">${box}${add}</div>`;
}

// Called after every render() once the markup is in the page. onChange re-renders the match page.
function bindMatchPhotos(token, onChange) {
  photoToken = token;
  photoOnChange = onChange;
  const box = document.getElementById('match-photo-box');
  if (box) {
    box.addEventListener('click', () => openPhotoViewer(0));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPhotoViewer(0); }
    });
  }
  const addBtn = document.getElementById('match-photo-add');
  if (addBtn) addBtn.addEventListener('click', () => { if (!photoUploading) ensurePhotoFileInput().click(); });
}

// One file input that lives on <body> for good: the page markup is replaced all the time (every score update), and an input that
// is removed from the page while the phone's picker is open would never report the chosen photo.
function ensurePhotoFileInput() {
  if (photoFileInput) return photoFileInput;
  photoFileInput = document.createElement('input');
  photoFileInput.type = 'file';
  photoFileInput.accept = 'image/*';
  photoFileInput.hidden = true;
  photoFileInput.addEventListener('change', () => {
    const file = photoFileInput.files && photoFileInput.files[0];
    photoFileInput.value = ''; // so choosing the same photo again still fires "change"
    if (file) uploadMatchPhoto(file);
  });
  document.body.appendChild(photoFileInput);
  return photoFileInput;
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
// canvas -> JPEG. If the picture cannot be decoded here (an odd format), the original file is returned and the server decides.
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
    // a small JPEG that did not need shrinking can come out bigger after re-encoding: keep the original then
    if (scale === 1 && file.type === 'image/jpeg' && blob.size >= file.size) return file;
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
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(caption)}">
      ${photos.length > 1 ? `
        <button type="button" class="photo-viewer-arrow prev" aria-label="&lsaquo;">&lsaquo;</button>
        <button type="button" class="photo-viewer-arrow next" aria-label="&rsaquo;">&rsaquo;</button>` : ''}
    </div>
    ${photos.length > 1 ? `<div class="photo-viewer-strip">${photos.map((p, i) => `
      <button type="button" class="photo-viewer-thumb${i === photoViewerIndex ? ' on' : ''}" data-index="${i}"><img src="${escapeHtml(p.thumbUrl)}" alt=""></button>`).join('')}</div>` : ''}
    <div class="photo-viewer-caption">
      <span>${escapeHtml(caption)}</span>
      ${photo.canRemove ? `<button type="button" class="photo-viewer-remove">${escapeHtml(t('match.photoRemove'))}</button>` : ''}
    </div>`;
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
