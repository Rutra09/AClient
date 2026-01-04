const db = require('../database');

function isAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has admin role
    db.get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row || row.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        next();
    });
}

module.exports = isAdmin;
