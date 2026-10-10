// /api/articles — the blog. Public: the list of the published articles. Admin (Backend > Blog): every article, create / edit / delete, and the
// upload of a picture for an article. The texts an admin saves are cleaned (src/htmlSanitize.js) and the addresses checked (src/seo.js) in
// src/blog.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { requireAdmin } = require('../auth');
const blog = require('../blog');

const router = express.Router();

const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)),
});

// public: the published articles of one language, newest first
router.get('/', (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'sk';
  res.json(blog.publishedRows().map((row) => {
    const a = blog.pick(row, lang);
    return { slug: a.slug, title: a.title, excerpt: a.excerpt, image: a.image, publishedAt: a.published };
  }));
});

router.get('/admin', requireAdmin, (req, res) => res.json(blog.adminList()));

router.get('/admin/:id', requireAdmin, (req, res) => {
  const article = blog.getById(req.params.id);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  res.json(article);
});

router.post('/admin', requireAdmin, (req, res) => {
  const r = blog.create(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.status(201).json(r.article);
});

router.put('/admin/:id', requireAdmin, (req, res) => {
  const r = blog.update(req.params.id, req.body);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  res.json(r.article);
});

router.delete('/admin/:id', requireAdmin, (req, res) => {
  if (!blog.remove(req.params.id)) return res.status(404).json({ error: 'Article not found' });
  res.json({ ok: true });
});

// a picture for an article (the featured picture, or one inside the text): kept on the persistent disk, shown at /blog-images/<file>
router.post('/upload', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be under 6 MB' : 'Could not process the uploaded file' });
    if (!req.file) return res.status(400).json({ error: 'Upload a PNG, JPG, WebP or GIF picture' });
    const filename = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${MIME_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(blog.UPLOAD_DIR, filename), req.file.buffer);
    res.status(201).json({ url: `/blog-images/${filename}` });
  });
});

module.exports = router;
