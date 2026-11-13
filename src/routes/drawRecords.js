// A draw that was made in front of the camera, as anybody may see it once it is saved (GET /api/draw-records/:id): the plan (to replay it), the key and its lock (to check
// the shuffle), the number of times a draw was started for the category. See src/liveDraw.js.
const express = require('express');
const liveDraw = require('../liveDraw');

const router = express.Router();

router.get('/:id', (req, res) => {
  const record = liveDraw.publicRecord(req.params.id);
  if (!record) return res.status(404).json({ error: 'This draw was not found' });
  res.json(record);
});

module.exports = router;
