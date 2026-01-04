const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Register
router.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const hash = bcrypt.hashSync(password, 10);

    db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, [username, hash], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: 'Username already exists' });
            }
            return res.status(500).json({ error: err.message });
        }

        const token = jwt.sign({ id: this.lastID, username }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ token, userId: this.lastID });
    });
});

// Login
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        if (!bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ token, userId: user.id });
    });
});

// Show reset password form
router.get('/reset-password', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).send('Invalid or missing reset token');
    }
    
    // Check if token is valid
    db.get(`SELECT t.*, u.username 
            FROM password_reset_tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.token = ? AND t.used = 0 AND datetime(t.expires_at) > datetime('now')`,
        [token],
        (err, tokenData) => {
            if (err) return res.status(500).send('Database error');
            if (!tokenData) return res.status(400).send('Invalid or expired reset token');
            
            // Render reset password form
            res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Reset Password</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input { width: 100%; padding: 8px; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; width: 100%; }
        button:hover { background: #0056b3; }
        .error { color: red; margin-top: 10px; }
        .success { color: green; margin-top: 10px; }
    </style>
</head>
<body>
    <h2>Reset Password for ${tokenData.username}</h2>
    <form id="resetForm">
        <div class="form-group">
            <label>New Password:</label>
            <input type="password" id="password" required minlength="6">
        </div>
        <div class="form-group">
            <label>Confirm Password:</label>
            <input type="password" id="confirmPassword" required minlength="6">
        </div>
        <button type="submit">Reset Password</button>
        <div id="message"></div>
    </form>
    <script>
        document.getElementById('resetForm').onsubmit = async (e) => {
            e.preventDefault();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const messageDiv = document.getElementById('message');
            
            if (password !== confirmPassword) {
                messageDiv.className = 'error';
                messageDiv.textContent = 'Passwords do not match';
                return;
            }
            
            try {
                const response = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: '${token}', password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    messageDiv.className = 'success';
                    messageDiv.textContent = 'Password reset successfully! You can now login.';
                    document.getElementById('resetForm').reset();
                } else {
                    messageDiv.className = 'error';
                    messageDiv.textContent = data.error || 'Failed to reset password';
                }
            } catch (err) {
                messageDiv.className = 'error';
                messageDiv.textContent = 'Network error: ' + err.message;
            }
        };
    </script>
</body>
</html>
            `);
        }
    );
});

// Reset password with token
router.post('/reset-password', (req, res) => {
    const { token, password } = req.body;
    
    if (!token || !password) {
        return res.status(400).json({ error: 'Token and new password required' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Verify token
    db.get(`SELECT * FROM password_reset_tokens 
            WHERE token = ? AND used = 0 AND datetime(expires_at) > datetime('now')`,
        [token],
        (err, tokenData) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!tokenData) return res.status(400).json({ error: 'Invalid or expired token' });
            
            // Hash new password
            const hash = bcrypt.hashSync(password, 10);
            
            // Update user password
            db.run('UPDATE users SET password_hash = ? WHERE id = ?',
                [hash, tokenData.user_id],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    // Mark token as used
                    db.run('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', [token]);
                    
                    // Log activity
                    db.run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
                        [tokenData.user_id, 'password_reset', 'Password reset via admin token']);
                    
                    res.json({ message: 'Password reset successfully' });
                }
            );
        }
    );
});


module.exports = router;