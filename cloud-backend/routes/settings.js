const express = require('express');
const db = require('../database');
const authenticateToken = require('../middleware/authMiddleware');

const router = express.Router();

// Get Settings
router.get('/', authenticateToken, (req, res) => {
    db.get(`SELECT data, updated_at FROM settings WHERE user_id = ?`, [req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.json({ settings: {}, updatedAt: null });

        try {
            const settings = JSON.parse(row.data);
            res.json({ settings, updatedAt: row.updated_at });
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse settings data' });
        }
    });
});

// Save Settings
router.post('/', authenticateToken, (req, res) => {
    const { settings } = req.body;
    if (!settings) return res.status(400).json({ error: 'Settings data required' });

    const data = JSON.stringify(settings);
    const timestamp = new Date().toISOString();

    db.run(`INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        [req.user.id, data, timestamp],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, updatedAt: timestamp });
        }
    );
});

module.exports = router;
