const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize Database
const initDatabase = require('./database/init');
const db = initDatabase();
// Initialize background AI processing queue (ultra‑lite)
const backgroundQueue = require('./services/backgroundQueue');
backgroundQueue.init(db);

// Middleware
const { attachUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Security and utility middleware
app.use(cors({
    origin: true, // reflect the request origin
    credentials: true // allow cookies
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session configuration
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.sqlite',
        dir: path.join(__dirname, 'database')
    }),
    secret: process.env.SESSION_SECRET || 'photovault-secret-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// Attach user info to locals
app.use(attachUser);

// Ensure upload directories exist
const uploadDirs = ['original', 'thumbnails', 'previews', 'watermarks', 'avatars'];
uploadDirs.forEach(dir => {
    const dirPath = path.join(__dirname, 'uploads', dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// Mount API Routes
app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/galleries', require('./routes/gallery')(db));
app.use('/api/images', require('./routes/images')(db));
app.use('/api/search', require('./routes/search')(db));
app.use('/api/face', require('./routes/face')(db));
app.use('/api/cart', require('./routes/cart')(db));
app.use('/api/subscriptions', require('./routes/subscription')(db));
app.use('/api/payments', require('./routes/payments'));
// Retain admin route registration
app.use('/api/admin', require('./routes/admin')(db));
app.use('/api', require('./routes/cloud')(db));
app.use('/api/pages', require('./routes/pages')(db));

// Public branding endpoint (no auth required)
app.get('/api/branding', (req, res) => {
    try {
        const keys = ['site_name', 'site_logo', 'brand_color', 'footer_text', 'site_tagline'];
        const rows = db.prepare(`SELECT key, value FROM system_settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
        const branding = {};
        rows.forEach(r => branding[r.key] = r.value);
        res.json({ success: true, branding });
    } catch (e) {
        res.json({ success: true, branding: {} });
    }
});

// Static files - disable caching in development to prevent stale JS/CSS
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
        // Prevent caching of HTML, JS, CSS files during development
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Explicit clean URLs routing fallback (resolves issues with query parameters on some node environments)
app.get('/:page', (req, res, next) => {
    const page = req.params.page;
    if (page.startsWith('api') || page.includes('.')) {
        return next();
    }
    const filePath = path.join(__dirname, 'public', `${page}.html`);
    if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
    }
    next();
});

// Prevent right-click and unauthorized access to original images via static middleware
app.use('/uploads/original', (req, res, next) => {
    // Should be handled by /api/images/:id/original
    res.status(403).json({ error: 'Direct access to original files is forbidden.' });
});

// Serve thumbnails and previews (as fallback if not using API routes)
app.use('/uploads/thumbnails', express.static(path.join(__dirname, 'uploads/thumbnails'), { maxAge: '1d' }));
app.use('/uploads/previews', express.static(path.join(__dirname, 'uploads/previews'), { maxAge: '1h' }));
app.use('/uploads/avatars', express.static(path.join(__dirname, 'uploads/avatars'), { maxAge: '1d' }));

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global Error:', err.stack);
    res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 PhotoVault Server is running on http://localhost:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    db.close();
    console.log('Database connection closed.');
    process.exit(0);
});
