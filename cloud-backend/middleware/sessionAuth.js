function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.redirect('/api/admin/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.userId || req.session.role !== 'admin') {
        return res.status(403).send('Admin access required');
    }
    next();
}

module.exports = { requireAuth, requireAdmin };
