const express = require('express');
const router  = express.Router();
const db = require('../db');

// GET /workers?park=P1
router.get('/', async (req, res) => {
  try {
    const workers = req.query.park
      ? await db.getWorkersByPark(req.query.park)
      : await db.getAllWorkers();
    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /workers/stats/summary
router.get('/stats/summary', async (req, res) => {
  try {
    res.json(await db.getTodayStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /workers/:id
router.get('/:id', async (req, res) => {
  try {
    const worker = await db.getWorkerById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'No encontrado' });
    res.json(worker);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
