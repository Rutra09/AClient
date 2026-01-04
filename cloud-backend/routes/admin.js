const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/sessionAuth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Login page
router.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/api/admin/dashboard');
    }
    res.render('admin/login', { error: null });
});

// Login POST
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
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
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        
        // Log activity
        db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'admin_login', 'Admin logged in']);
        
        res.redirect('/api/admin/dashboard');
    });
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
router.get('/users', (req, res) => {
    db.all(`SELECT u.id, u.username, u.role, u.created_at,
                   ul.max_versions, ul.max_storage_mb,
                   COUNT(DISTINCT a.filename) as file_count,
                   SUM(a.size) as total_size
            FROM users u
            LEFT JOIN user_limits ul ON u.id = ul.user_id
            LEFT JOIN assets a ON u.id = a.user_id
            GROUP BY u.id
            ORDER BY u.created_at DESC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ users: rows });
        }
    );
});

// Get user details
router.get('/users/:id', (req, res) => {
    const userId = req.params.id;
    
    db.get(`SELECT u.*, ul.max_versions, ul.max_storage_mb
            FROM users u
            LEFT JOIN user_limits ul ON u.id = ul.user_id
            WHERE u.id = ?`, [userId],
        (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.status(404).json({ error: 'User not found' });
            
            // Get user's files
            db.all(`SELECT filename, MAX(version) as latest_version, 
                           COUNT(*) as version_count, SUM(size) as total_size,
                           MAX(created_at) as last_updated
                    FROM assets 
                    WHERE user_id = ? 
                    GROUP BY filename`,
                [userId],
                (err, files) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    res.json({ user, files });
                }
            );
        }
    );
    db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'admin_login', 'User details retrieved']);
});

// Update user limits
router.put('/users/:id/limits', (req, res) => {
    const userId = req.params.id;
    const { max_versions, max_storage_mb } = req.body;
    
    if (!max_versions || !max_storage_mb) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Insert or update user limits
    db.run(`INSERT INTO user_limits (user_id, max_versions, max_storage_mb)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                max_versions = excluded.max_versions,
                max_storage_mb = excluded.max_storage_mb`,
        [userId, max_versions, max_storage_mb],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Log activity
            db.run(`INSERT INTO activity_log (user_id, action, details)
                    VALUES (?, 'limits_updated', ?)`,
                [req.session.userId, `Updated limits for user ${userId}: ${max_versions} versions, ${max_storage_mb} MB`]
            );
            
            res.json({ message: 'Limits updated successfully' });
        }
    );
    db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
            [req.session.userId, 'admin_login', 'User limits updated']);
});

// Update user role
router.put('/users/:id/role', (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;
    
    if (!role || !['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    
    db.run(`UPDATE users SET role = ? WHERE id = ?`,
        [role, userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Log activity
            db.run(`INSERT INTO activity_log (user_id, action, details)
                    VALUES (?, 'role_updated', ?)`,
                [req.session.userId, `Changed user ${userId} role to ${role}`]
            );
            
            res.json({ message: 'Role updated successfully' });
        }
    );
    db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
            [req.session.userId, 'admin_login', 'User role updated']);
});

// Get all files across all users
router.get('/files', (req, res) => {
    db.all(`SELECT a.*, u.username
            FROM assets a
            JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC
            LIMIT 100`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ files: rows });
        }
    );
    db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
            [req.session.userId, 'admin_login', 'All files retrieved']);
});

// View file content
router.get('/files/:id/content', (req, res) => {
    const fileId = req.params.id;
    
    db.get(`SELECT * FROM assets WHERE id = ?`, [fileId], (err, file) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!file) return res.status(404).json({ error: 'File not found' });
        
        fs.readFile(file.path, 'utf8', (err, content) => {
            if (err) {
                // Try reading as binary if UTF-8 fails
                fs.readFile(file.path, (err, buffer) => {
                    if (err) return res.status(500).json({ error: 'Failed to read file' });
                    res.json({ 
                        file,
                        content: buffer.toString('base64'),
                        encoding: 'base64'
                    });
                });
            } else { 
                db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
            [req.session.userId, 'admin_login', 'File content retrieved for file ' + fileId + " which belongs to user " + file.user_id]);

                res.json({ 
                    file,
                    content,
                    encoding: 'utf8'
                });
            }
        });
    });
   });

// Get activity log
router.get('/activity', (req, res) => {
    const limit = req.query.limit || 50;
    
    db.all(`SELECT al.*, u.username
            FROM activity_log al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC
            LIMIT ?`,
        [limit],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ activity: rows });
            db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
                    [req.session.userId, 'admin_login', 'Activity log retrieved']);
        }
    );
});

// Get statistics
router.get('/stats', (req, res) => {
    const stats = {};
    
    // Total users
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        stats.total_users = row.count;
        db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
                [req.session.userId, 'admin_login', 'Statistics retrieved']);
        
        // Total files
        db.get('SELECT COUNT(*) as count, SUM(size) as total_size FROM assets', (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            stats.total_files = row.count;
            stats.total_size = row.total_size || 0;
            
            // Recent activity
            db.get('SELECT COUNT(*) as count FROM activity_log WHERE created_at > datetime("now", "-24 hours")', (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                stats.recent_activity = row.count;
                
                res.json(stats);
            });
        });
    });
});

// Generate password reset link for user
router.post('/users/:id/reset-token', (req, res) => {
    const userId = req.params.id;
    const { expiresInHours } = req.body;
    
    // Check if user exists
    db.get('SELECT id, username FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        // Generate secure token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (expiresInHours || 24));
        
        // Insert token into database
        db.run(`INSERT INTO password_reset_tokens (user_id, token, created_by, expires_at) 
                VALUES (?, ?, ?, ?)`,
            [userId, token, req.session.userId, expiresAt.toISOString()],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                // Log activity
                db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
                    [req.session.userId, 'generate_reset_token', `Generated reset token for user ${user.username}`]);
                
                const resetLink = `${req.protocol}://${req.get('host')}/api/auth/reset-password?token=${token}`;
                
                res.json({ 
                    token,
                    resetLink,
                    expiresAt,
                    user: {
                        id: user.id,
                        username: user.username
                    }
                });
            }
        );
    });
});

// Get active reset tokens for a user
router.get('/users/:id/reset-tokens', (req, res) => {
    const userId = req.params.id;
    
    db.all(`SELECT t.*, u.username as created_by_username
            FROM password_reset_tokens t
            LEFT JOIN users u ON t.created_by = u.id
            WHERE t.user_id = ? AND t.used = 0 AND datetime(t.expires_at) > datetime('now')
            ORDER BY t.created_at DESC`,
        [userId],
        (err, tokens) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ tokens });
        }
    );
});

// Revoke reset token
router.delete('/reset-tokens/:token', (req, res) => {
    const token = req.params.token;
    
    db.run('UPDATE password_reset_tokens SET used = 1 WHERE token = ?',
        [token],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Token not found' });
            
            db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
                [req.session.userId, 'revoke_reset_token', `Revoked reset token ${token}`]);
            
            res.json({ message: 'Token revoked successfully' });
        }
    );
});


module.exports = router;