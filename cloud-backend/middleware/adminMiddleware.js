const { ObjectId } = require('mongodb');
const database = require('../database');

async function isAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        await database.connectDB();
        const db = database.getDatabase();
        const userId = new ObjectId(req.user.id);
        const user = await db.collection('users').findOne(
            { _id: userId },
            { projection: { role: 1 } }
        );
        
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        next();
    } catch (err) {
        console.error('Admin check error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
}

module.exports = isAdmin;
