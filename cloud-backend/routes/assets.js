const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const authenticateToken = require('../middleware/authMiddleware');

const router = express.Router();

// Configure multer for multipart uploads (optional, but good to have)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, req.user.id + '-' + Date.now() + '-' + file.originalname)
    }
});
const upload = multer({ storage: storage });

// Upload Asset (supports both multipart and raw body)
// For raw body, we expect X-Filename header
router.post('/', authenticateToken, (req, res) => {
    const userId = req.user.id;
    
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        // Handle via multer if it was multipart (though we didn't put the middleware here yet)
        // Actually let's just support raw body for the client's sake as it's easier to implement in C++
        return res.status(400).json({ error: 'Use raw body for uploads with X-Filename header' });
    }

    const filename = req.headers['x-filename'];
    if (!filename) {
        return res.status(400).json({ error: 'Missing X-Filename header' });
    }

    const safeFilename = path.basename(filename);
    const targetPath = path.join('uploads', userId + '-' + Date.now() + '-' + safeFilename);

    fs.writeFile(targetPath, req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run(`INSERT INTO assets (user_id, filename, path, size) VALUES (?, ?, ?, ?)`,
            [userId, safeFilename, targetPath, req.body.length],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ filename: safeFilename, message: 'Upload successful' });
            }
        );
    });
});

// List Assets
router.get('/', authenticateToken, (req, res) => {
    db.all(`SELECT filename, size, created_at FROM assets WHERE user_id = ?`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ assets: rows });
    });
});

// Download Asset
router.get('/:filename', authenticateToken, (req, res) => {
    const filename = req.params.filename;
    // Find the latest file with this name for the user
    db.get(`SELECT path FROM assets WHERE user_id = ? AND filename = ? ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, filename],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Asset not found' });

            res.download(row.path, filename);
        }
    );
});

module.exports = router;
