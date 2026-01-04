const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('../middleware/sessionAuth');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
const database = require('../database');

const router = express.Router();

// Login page
router.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/api/admin/dashboard');
    }
    res.render('admin/login', { error: null });
});

// Login POST
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const user = await db.collection('users').findOne({ username });
        
        if (!user) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }
        
        if (user.role !== 'admin') {
            return res.render('admin/login', { error: 'Admin access required' });
        }
        
        // Set session
        req.session.userId = user._id.toString();
        req.session.username = user.username;
        req.session.role = user.role;
        
        // Log activity
        await db.collection('activity_log').insertOne({
            user_id: user._id.toString(),
            action: 'admin_login',
            details: 'Admin logged in',
            created_at: new Date()
        });
        
        res.redirect('/api/admin/dashboard');
    } catch (err) {
        console.error('Login error:', err);
        res.render('admin/login', { error: 'Server error' });
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/api/admin/login');
});

// Dashboard page (requires auth)
router.get('/dashboard', requireAuth, requireAdmin, (req, res) => {
    res.render('admin/dashboard', { 
        user: { 
            id: req.session.userId,
            username: req.session.username 
        } 
    });
});

// All API routes require authentication and admin role
router.use(requireAuth);
router.use(requireAdmin);

// Get all users
router.get('/users', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        
        const users = await db.collection('users').aggregate([
            {
                $lookup: {
                    from: 'user_limits',
                    localField: '_id',
                    foreignField: 'user_id',
                    as: 'limits'
                }
            },
            {
                $lookup: {
                    from: 'assets',
                    localField: '_id',
                    foreignField: 'user_id',
                    as: 'assets'
                }
            },
            {
                $project: {
                    id: { $toString: '$_id' },
                    username: 1,
                    role: 1,
                    created_at: 1,
                    max_versions: { $ifNull: [{ $arrayElemAt: ['$limits.max_versions', 0] }, 3] },
                    max_storage_mb: { $ifNull: [{ $arrayElemAt: ['$limits.max_storage_mb', 0] }, 100] },
                    file_count: { $size: { $setUnion: ['$assets.filename', []] } },
                    total_size: { $ifNull: [{ $sum: '$assets.size' }, 0] }
                }
            },
            { $sort: { created_at: -1 } }
        ]).toArray();
        
        res.json({ users });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get user details
router.get('/users/:id', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = new ObjectId(req.params.id);
        
        const user = await db.collection('users').aggregate([
            { $match: { _id: userId } },
            {
                $lookup: {
                    from: 'user_limits',
                    localField: '_id',
                    foreignField: 'user_id',
                    as: 'limits'
                }
            },
            {
                $project: {
                    id: { $toString: '$_id' },
                    username: 1,
                    role: 1,
                    created_at: 1,
                    max_versions: { $ifNull: [{ $arrayElemAt: ['$limits.max_versions', 0] }, 3] },
                    max_storage_mb: { $ifNull: [{ $arrayElemAt: ['$limits.max_storage_mb', 0] }, 100] }
                }
            }
        ]).toArray();
        
        if (!user || user.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const files = await db.collection('assets').aggregate([
            { $match: { user_id: userId } },
            {
                $group: {
                    _id: '$filename',
                    latest_version: { $max: '$version' },
                    version_count: { $sum: 1 },
                    total_size: { $sum: '$size' },
                    last_updated: { $max: '$created_at' }
                }
            },
            {
                $project: {
                    filename: '$_id',
                    latest_version: 1,
                    version_count: 1,
                    total_size: 1,
                    last_updated: 1
                }
            }
        ]).toArray();
        
        res.json({ user: user[0], files });
    } catch (err) {
        console.error('Get user details error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update user limits
router.put('/users/:id/limits', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = new ObjectId(req.params.id);
        const { max_versions, max_storage_mb } = req.body;
        
        if (!max_versions || !max_storage_mb) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        await db.collection('user_limits').updateOne(
            { user_id: userId },
            { 
                $set: { 
                    max_versions: parseInt(max_versions),
                    max_storage_mb: parseInt(max_storage_mb)
                }
            },
            { upsert: true }
        );
        
        await db.collection('activity_log').insertOne({
            user_id: req.session.userId,
            action: 'limits_updated',
            details: `Updated limits for user ${userId}: ${max_versions} versions, ${max_storage_mb} MB`,
            created_at: new Date()
        });
        
        res.json({ message: 'Limits updated successfully' });
    } catch (err) {
        console.error('Update limits error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update user role
router.put('/users/:id/role', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = new ObjectId(req.params.id);
        const { role } = req.body;
        
        if (!role || !['user', 'admin'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        
        await db.collection('users').updateOne(
            { _id: userId },
            { $set: { role } }
        );
        
        await db.collection('activity_log').insertOne({
            user_id: req.session.userId,
            action: 'role_updated',
            details: `Changed user ${userId} role to ${role}`,
            created_at: new Date()
        });
        
        res.json({ message: 'Role updated successfully' });
    } catch (err) {
        console.error('Update role error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get all files across all users
router.get('/files', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        
        const files = await db.collection('assets').aggregate([
            {
                $addFields: {
                    user_id_obj: { $cond: { if: { $eq: [{ $type: '$user_id' }, 'objectId'] }, then: '$user_id', else: { $toObjectId: '$user_id' } } }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user_id_obj',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $project: {
                    id: { $toString: '$_id' },
                    user_id: { $cond: { if: { $eq: [{ $type: '$user_id' }, 'objectId'] }, then: { $toString: '$user_id' }, else: '$user_id' } },
                    username: { $arrayElemAt: ['$user.username', 0] },
                    filename: 1,
                    version: 1,
                    size: 1,
                    created_at: 1,
                    path: 1
                }
            },
            { $sort: { created_at: -1 } },
            { $limit: 100 }
        ]).toArray();
        
        res.json({ files });
    } catch (err) {
        console.error('Get files error:', err);
        res.status(500).json({ error: err.message });
    }
});

// View file content
router.get('/files/:id/content', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const fileId = new ObjectId(req.params.id);
        
        const file = await db.collection('assets').findOne({ _id: fileId });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        fs.readFile(file.path, 'utf8', (err, content) => {
            if (err) {
                fs.readFile(file.path, (err, buffer) => {
                    if (err) return res.status(500).json({ error: 'Failed to read file' });
                    res.json({ 
                        file,
                        content: buffer.toString('base64'),
                        encoding: 'base64'
                    });
                });
            } else {
                db.collection('activity_log').insertOne({
                    user_id: req.session.userId,
                    action: 'file_viewed',
                    details: `File content retrieved for ${file.filename}`,
                    created_at: new Date()
                });
                
                res.json({ 
                    file,
                    content,
                    encoding: 'utf8'
                });
            }
        });
    } catch (err) {
        console.error('View file error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get activity log
router.get('/activity', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const limit = parseInt(req.query.limit) || 50;
        
        const activity = await db.collection('activity_log').aggregate([
            {
                $addFields: {
                    user_id_obj: { $toObjectId: '$user_id' }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user_id_obj',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $project: {
                    username: { $arrayElemAt: ['$user.username', 0] },
                    action: 1,
                    details: 1,
                    created_at: 1
                }
            },
            { $sort: { created_at: -1 } },
            { $limit: limit }
        ]).toArray();
        
        res.json({ activity });
    } catch (err) {
        console.error('Get activity error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get statistics
router.get('/stats', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        
        const totalUsers = await db.collection('users').countDocuments();
        const assetStats = await db.collection('assets').aggregate([
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    total_size: { $sum: '$size' }
                }
            }
        ]).toArray();
        
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        const recentActivity = await db.collection('activity_log').countDocuments({
            created_at: { $gte: yesterday }
        });
        
        res.json({
            total_users: totalUsers,
            total_files: assetStats[0]?.count || 0,
            total_size: assetStats[0]?.total_size || 0,
            recent_activity: recentActivity
        });
    } catch (err) {
        console.error('Get stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Generate password reset link for user
router.post('/users/:id/reset-token', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = new ObjectId(req.params.id);
        const { expiresInHours } = req.body;
        
        const user = await db.collection('users').findOne(
            { _id: userId },
            { projection: { _id: 1, username: 1 } }
        );
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (expiresInHours || 24));
        
        await db.collection('password_reset_tokens').insertOne({
            user_id: userId.toString(),
            token,
            created_by: req.session.userId,
            used: 0,
            created_at: new Date(),
            expires_at: expiresAt
        });
        
        await db.collection('activity_log').insertOne({
            user_id: req.session.userId,
            action: 'generate_reset_token',
            details: `Generated reset token for user ${user.username}`,
            created_at: new Date()
        });
        
        const resetLink = `${req.protocol}://${req.get('host')}/api/auth/reset-password?token=${token}`;
        
        res.json({ 
            token,
            resetLink,
            expiresAt,
            user: {
                id: user._id.toString(),
                username: user.username
            }
        });
    } catch (err) {
        console.error('Generate reset token error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get active reset tokens for a user
router.get('/users/:id/reset-tokens', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = req.params.id;
        
        const tokens = await db.collection('password_reset_tokens').aggregate([
            {
                $match: {
                    user_id: userId,
                    used: 0,
                    expires_at: { $gt: new Date() }
                }
            },
            {
                $addFields: {
                    created_by_obj: { $toObjectId: '$created_by' }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'created_by_obj',
                    foreignField: '_id',
                    as: 'creator'
                }
            },
            {
                $project: {
                    token: 1,
                    created_at: 1,
                    expires_at: 1,
                    created_by_username: { $arrayElemAt: ['$creator.username', 0] }
                }
            },
            { $sort: { created_at: -1 } }
        ]).toArray();
        
        res.json({ tokens });
    } catch (err) {
        console.error('Get reset tokens error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Revoke reset token
router.delete('/reset-tokens/:token', async (req, res) => {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        const token = req.params.token;
        
        const result = await db.collection('password_reset_tokens').updateOne(
            { token },
            { $set: { used: 1 } }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Token not found' });
        }
        
        await db.collection('activity_log').insertOne({
            user_id: req.session.userId,
            action: 'revoke_reset_token',
            details: `Revoked reset token ${token}`,
            created_at: new Date()
        });
        
        res.json({ message: 'Token revoked successfully' });
    } catch (err) {
        console.error('Revoke token error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
