const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const database = require('../database');

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Register
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        await database.connectDB();
        const db = database.getDatabase();
        const hash = await bcrypt.hash(password, 10);

        const result = await db.collection('users').insertOne({
            username,
            password_hash: hash,
            role: 'user',
            created_at: new Date()
        });

        const userId = result.insertedId.toString();
        const token = jwt.sign({ id: userId, username }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ token, userId });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: 'Username already exists' });
        }
        console.error('Register error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        await database.connectDB();
        const db = database.getDatabase();
        const user = await db.collection('users').findOne({ username });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userId = user._id.toString();
        const token = jwt.sign({ id: userId, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ token, userId });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Show reset password form
router.get('/reset-password', async (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).send('Invalid or missing reset token');
    }
    
    try {
        await database.connectDB();
        const db = database.getDatabase();
        
        const tokenData = await db.collection('password_reset_tokens').aggregate([
            {
                $match: {
                    token,
                    used: 0,
                    expires_at: { $gt: new Date() }
                }
            },
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
                    user_id: 1
                }
            }
        ]).toArray();
        
        if (!tokenData || tokenData.length === 0) {
            return res.status(400).send('Invalid or expired reset token');
        }
        
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
    <h2>Reset Password for ${tokenData[0].username}</h2>
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
    } catch (err) {
        console.error('Reset password form error:', err);
        res.status(500).send('Server error');
    }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    
    if (!token || !password) {
        return res.status(400).json({ error: 'Token and new password required' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    try {
        await database.connectDB();
        const db = database.getDatabase();
        
        const tokenData = await db.collection('password_reset_tokens').findOne({
            token,
            used: 0,
            expires_at: { $gt: new Date() }
        });
        
        if (!tokenData) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }
        
        const hash = await bcrypt.hash(password, 10);
        const userId = new ObjectId(tokenData.user_id);
        
        await db.collection('users').updateOne(
            { _id: userId },
            { $set: { password_hash: hash } }
        );
        
        await db.collection('password_reset_tokens').updateOne(
            { token },
            { $set: { used: 1 } }
        );
        
        await db.collection('activity_log').insertOne({
            user_id: tokenData.user_id,
            action: 'password_reset',
            details: 'Password reset via admin token',
            created_at: new Date()
        });
        
        res.json({ message: 'Password reset successfully' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;


