const express = require('express');
const path = require('path');
const fs = require('fs');
const authenticateToken = require('../middleware/authMiddleware');
const { ObjectId } = require('mongodb');
const database = require('../database');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Middleware for raw body parsing
const rawParser = express.raw({ 
    type: () => true, 
    limit: process.env.MAX_FILE_SIZE || '20mb' 
});

// Helper function to get user's version limit
async function getUserVersionLimit(userId) {
    await database.connectDB();
    const db = database.getDatabase();
    const userIdObj = new ObjectId(userId);
    const row = await db.collection('user_limits').findOne({ user_id: userIdObj });
    return row ? row.max_versions : 3; // Default to 3 if not set
}

// Helper function to cleanup old versions
async function cleanupOldVersions(userId, filename, maxVersions) {
    await database.connectDB();
    const db = database.getDatabase();
    const userIdObj = new ObjectId(userId);
    
    const rows = await db.collection('assets')
        .find({ user_id: userIdObj, filename })
        .sort({ version: -1 })
        .toArray();
    
    if (rows.length >= maxVersions) {
        const toDelete = rows.slice(maxVersions - 1);
        
        for (const row of toDelete) {
            // Delete file from disk
            try {
                fs.unlinkSync(row.path);
            } catch (err) {
                console.error('Error deleting file:', err);
            }
            
            // Delete from database
            await db.collection('assets').deleteOne({ _id: row._id });
        }
    }
}

// Upload Asset (supports both multipart and raw body)
// For raw body, we expect X-Filename header
router.post('/', authenticateToken, rawParser, async (req, res) => {
    const userId = req.user.id;
    
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        return res.status(400).json({ error: 'Use raw body for uploads with X-Filename header' });
    }

    const filename = req.headers['x-filename'];
    const localPath = req.headers['x-local-path'] || filename;
    if (!filename) {
        return res.status(400).json({ error: 'Missing X-Filename header' });
    }

    const safeFilename = path.basename(filename);
    
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userIdObj = new ObjectId(userId);
        const maxVersions = await getUserVersionLimit(userId);
        
        const result = await db.collection('assets')
            .find({ user_id: userIdObj, filename: safeFilename })
            .sort({ version: -1 })
            .limit(1)
            .toArray();
        
        const newVersion = (result.length > 0 && result[0].version) ? result[0].version + 1 : 1;
        const targetPath = path.join(UPLOAD_DIR, userId + '-v' + newVersion + '-' + Date.now() + '-' + safeFilename);
        
        fs.writeFileSync(targetPath, req.body);
        
        await db.collection('assets').insertOne({
            user_id: userIdObj,
            filename: safeFilename,
            local_path: localPath,
            path: targetPath,
            size: req.body.length,
            version: newVersion,
            created_at: new Date()
        });
        
        await cleanupOldVersions(userId, safeFilename, maxVersions);
        
        res.json({ 
            filename: safeFilename, 
            version: newVersion,
            message: 'Upload successful' 
        });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get Inventory (list all assets with versions)
router.get('/inventory', authenticateToken, async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userIdObj = new ObjectId(req.user.id);
        
        const assets = await db.collection('assets').aggregate([
            { $match: { user_id: userIdObj } },
            {
                $group: {
                    _id: '$filename',
                    local_path: { $last: '$local_path' },
                    latest_version: { $max: '$version' },
                    version_count: { $sum: 1 },
                    total_size: { $sum: '$size' },
                    last_updated: { $max: '$created_at' }
                }
            },
            {
                $project: {
                    filename: '$_id',
                    local_path: 1,
                    latest_version: 1,
                    version_count: 1,
                    total_size: 1,
                    last_updated: 1
                }
            },
            { $sort: { last_updated: -1 } }
        ]).toArray();
        
        const maxVersions = await getUserVersionLimit(req.user.id);
        const totalSize = assets.reduce((sum, asset) => sum + (asset.total_size || 0), 0);
        
        res.json({
            assets,
            storage_used_mb: (totalSize / (1024 * 1024)).toFixed(3),
            storage_limit_mb: 100,
            version_limit: maxVersions
        });
    } catch (err) {
        console.error('Get inventory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get versions of a specific file
router.get('/versions/:filename', authenticateToken, async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userIdObj = new ObjectId(req.user.id);
        const filename = req.params.filename;
        
        const rows = await db.collection('assets')
            .find({ user_id: userIdObj, filename })
            .sort({ version: -1 })
            .project({ version: 1, size: 1, created_at: 1, path: 1, local_path: 1 })
            .toArray();
        
        res.json({ versions: rows });
    } catch (err) {
        console.error('Get versions error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Download Asset (latest version by default)
router.get('/:filename', authenticateToken, async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userIdObj = new ObjectId(req.user.id);
        const filename = req.params.filename;
        const version = req.query.version;
        
        let row;
        if (version) {
            row = await db.collection('assets').findOne({
                user_id: userIdObj,
                filename,
                version: parseInt(version)
            });
        } else {
            const rows = await db.collection('assets')
                .find({ user_id: userIdObj, filename })
                .sort({ version: -1 })
                .limit(1)
                .toArray();
            row = rows[0];
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        res.download(row.path, filename);
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete specific version or all versions of a file
router.delete('/:filename', authenticateToken, async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userIdObj = new ObjectId(req.user.id);
        const filename = req.params.filename;
        const version = req.query.version;
        
        let query = { user_id: userIdObj, filename };
        if (version) {
            query.version = parseInt(version);
        }
        
        const rows = await db.collection('assets').find(query).toArray();
        
        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        
        for (const row of rows) {
            try {
                fs.unlinkSync(row.path);
            } catch (err) {
                console.error('Error deleting file:', err);
            }
            
            await db.collection('assets').deleteOne({ _id: row._id });
        }
        
        res.json({ message: `Deleted ${rows.length} version(s) of ${filename}` });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;



