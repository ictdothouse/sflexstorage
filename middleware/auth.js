/**
 * Authentication & Authorization Middleware
 */

// Require authenticated user
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    return res.redirect('/login');
}

// Require admin role
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.userId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        return res.redirect('/login.html');
    }
    if (req.session.userRole !== 'admin') {
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Admin access required.' });
        }
        return res.redirect('/');
    }
    return next();
}

// Optional auth - set user info if logged in
function optionalAuth(req, res, next) {
    // User info is already available via session
    next();
}

// Attach user data to response locals for templates
function attachUser(req, res, next) {
    res.locals.user = null;
    if (req.session && req.session.userId) {
        res.locals.user = {
            id: req.session.userId,
            username: req.session.username,
            email: req.session.email,
            role: req.session.userRole,
            fullName: req.session.fullName
        };
    }
    next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth, attachUser };
