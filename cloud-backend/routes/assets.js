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

// Helper function to get user's version limit
function getUserVersionLimit(userId, callback) {
    db.get(`SELECT max_versions FROM user_limits WHERE user_id = ?`, [userId], (err, row) => {
        if (err) return callback(err);
        callback(null, row ? row.max_versions : 3); // Default to 3 if not set
    });
}

// Helper function to cleanup old versions
function cleanupOldVersions(userId, filename, maxVersions, callback) {
    // Get all versions of this file for the user
    db.all(`SELECT id, path, version FROM assets 
            WHERE user_id = ? AND filename = ? 
            ORDER BY version DESC`,
        [userId, filename],
        (err, rows) => {
            if (err) return callback(err);
            
            // If we have more than max_versions, delete the oldest ones
            if (rows.length >= maxVersions) {
                const toDelete = rows.slice(maxVersions - 1); // Keep maxVersions - 1, delete the rest
                
                let deleted = 0;
                toDelete.forEach(row => {
                    // Delete file from disk
                    fs.unlink(row.path, (err) => {
                        if (err) console.error('Error deleting file:', err);
                    });
                    
                    // Delete from database
                    db.run(`DELETE FROM assets WHERE id = ?`, [row.id], (err) => {
                        if (err) console.error('Error deleting from DB:', err);
                        deleted++;
                        if (deleted === toDelete.length) {
                            callback(null);
                        }
                    });
                });
                
                if (toDelete.length === 0) callback(null);
            } else {
                callback(null);
            }
        }
    );
}

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
    
    // Get user's version limit
    getUserVersionLimit(userId, (err, maxVersions) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Get the latest version number for this file
        db.get(`SELECT MAX(version) as max_version FROM assets WHERE user_id = ? AND filename = ?`,
            [userId, safeFilename],
            (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                
                const newVersion = (row && row.max_version) ? row.max_version + 1 : 1;
                const targetPath = path.join('uploads', userId + '-v' + newVersion + '-' + Date.now() + '-' + safeFilename);
                
                fs.writeFile(targetPath, req.body, (err) => {
                    if (err) return res.status(500).json({ error: err.message });

                    db.run(`INSERT INTO assets (user_id, filename, path, size, version) VALUES (?, ?, ?, ?, ?)`,
                        [userId, safeFilename, targetPath, req.body.length, newVersion],
                        function(err) {
                            if (err) return res.status(500).json({ error: err.message });
                            
                            // Cleanup old versions
                            cleanupOldVersions(userId, safeFilename, maxVersions, (err) => {
                                if (err) console.error('Error cleaning up versions:', err);
                                
                                res.json({ 
                                    filename: safeFilename, 
                                    version: newVersion,
                                    message: 'Upload successful' 
                                });
                            });
                        }
                    );
                });
            }
        );
    });
});

// Get Inventory (list all assets with versions)
router.get('/inventory', authenticateToken, (req, res) => {
    const userId = req.user.id;
    
    // Get all assets grouped by filename with latest version info
    db.all(`SELECT filename, MAX(version) as latest_version, 
                   COUNT(*) as version_count,
                   SUM(size) as total_size,
                   MAX(created_at) as last_updated
            FROM assets 
            WHERE user_id = ? 
            GROUP BY filename
            ORDER BY last_updated DESC`,
        [userId],
        (err, assets) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Get user limits
            getUserVersionLimit(userId, (err, maxVersions) => {
                if (err) return res.status(500).json({ error: err.message });
                
                // Calculate total storage used
                const totalSize = assets.reduce((sum, asset) => sum + (asset.total_size || 0), 0);
                
                res.json({
                    assets: assets,
                    storage_used_mb: (totalSize / (1024 * 1024)).toFixed(3),
                    storage_limit_mb: 100, // TODO: Get from user_limits
                    version_limit: maxVersions
                });
            });
        }
    );
});

// Get versions of a specific file
router.get('/versions/:filename', authenticateToken, (req, res) => {
    const filename = req.params.filename;
    
    db.all(`SELECT version, size, created_at, path 
            FROM assets 
            WHERE user_id = ? AND filename = ? 
            ORDER BY version DESC`,
        [req.user.id, filename],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ versions: rows });
        }
    );
});

// Download Asset (latest version by default)
router.get('/:filename', authenticateToken, (req, res) => {
    const filename = req.params.filename;
    const version = req.query.version; // Optional version parameter
    
    let query, params;
    if (version) {
        query = `SELECT path FROM assets WHERE user_id = ? AND filename = ? AND version = ? LIMIT 1`;
        params = [req.user.id, filename, version];
    } else {
        query = `SELECT path FROM assets WHERE user_id = ? AND filename = ? ORDER BY version DESC LIMIT 1`;
        params = [req.user.id, filename];
    }
    
    db.get(query, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Asset not found' });

        res.download(row.path, filename);
    });
});

// Delete specific version or all versions of a file
router.delete('/:filename', authenticateToken, (req, res) => {
    const filename = req.params.filename;
    const version = req.query.version; // Optional
    
    let query, params;
    if (version) {
        query = `SELECT id, path FROM assets WHERE user_id = ? AND filename = ? AND version = ?`;
        params = [req.user.id, filename, version];
    } else {
        query = `SELECT id, path FROM assets WHERE user_id = ? AND filename = ?`;
        params = [req.user.id, filename];
    }
    
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
        
        let deleted = 0;
        rows.forEach(row => {
            // Delete file from disk
            fs.unlink(row.path, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
            
            // Delete from database
            db.run(`DELETE FROM assets WHERE id = ?`, [row.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                deleted++;
                if (deleted === rows.length) {
                    res.json({ message: `Deleted ${deleted} version(s) of ${filename}` });
                }
            });
        });
    });
});

module.exports = router;
