const express = require('express');
const authenticateToken = require('../middleware/authMiddleware');
const { ObjectId } = require('mongodb');
const database = require('../database');

const router = express.Router();

// Get Settings
router.get('/', authenticateToken, async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = new ObjectId(req.user.id);
        
        const row = await db.collection('settings').findOne({ user_id: userId });
        
        if (!row) {
            return res.json({ settings: {}, updatedAt: null });
        }

        try {
            const settings = JSON.parse(row.data);
            res.json({ settings, updatedAt: row.updated_at });
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse settings data' });
        }
    } catch (err) {
        console.error('Get settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Save Settings
router.post('/', authenticateToken, async (req, res) => {
    const { settings } = req.body;
    if (!settings) {
        return res.status(400).json({ error: 'Settings data required' });
    }

    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = new ObjectId(req.user.id);
        const data = JSON.stringify(settings);
        const timestamp = new Date();

        await db.collection('settings').updateOne(
            { user_id: userId },
            { 
                $set: { 
                    data,
                    updated_at: timestamp
                }
            },
            { upsert: true }
        );

        res.json({ success: true, updatedAt: timestamp });
    } catch (err) {
        console.error('Save settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
