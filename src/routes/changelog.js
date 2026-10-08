const express = require('express');
const changeLog = require('../changeLog');
const { requireAdmin } = require('../auth');

const router = express.Router();

// Backend > Log: the newest first; ?limit= (1-200), ?before=<id> for the next page, ?kind=, ?q= (a player or word).
router.get('/', requireAdmin, (req, res) => {
  res.json(changeLog.list({ limit: req.query.limit, before: req.query.before, kind: req.query.kind, q: req.query.q }));
});

module.exports = router;
