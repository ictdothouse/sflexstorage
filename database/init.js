const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'photovault.db');

function initDatabase() {
    const db = new Database(DB_PATH);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // ─── SUBSCRIPTION PLANS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            price_monthly REAL NOT NULL,
            price_yearly REAL DEFAULT NULL,
            downloads_per_month INTEGER DEFAULT -1,
            features TEXT DEFAULT '[]',
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `).run();

    // ─── PAYMENT SETTINGS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS payment_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gateway_name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            api_key TEXT DEFAULT '',
            secret_key TEXT DEFAULT '',
            extra_config TEXT DEFAULT '{}',
            is_sandbox INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `).run();

    // ─── USERS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
            avatar TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            subscription_plan_id INTEGER DEFAULT NULL,
            subscription_start TEXT DEFAULT NULL,
            subscription_expiry TEXT DEFAULT NULL,
            downloads_used_this_cycle INTEGER DEFAULT 0,
            downloads_cycle_reset TEXT DEFAULT NULL,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (subscription_plan_id) REFERENCES subscription_plans(id)
        )
    `).run();

    // ─── GALLERIES TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS galleries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            slug TEXT UNIQUE NOT NULL,
            access_level TEXT DEFAULT 'public' CHECK(access_level IN ('public', 'private', 'password', 'url_only')),
            password_hash TEXT DEFAULT NULL,
            cover_image_id INTEGER DEFAULT NULL,
            parent_gallery_id INTEGER DEFAULT NULL,
            sort_order INTEGER DEFAULT 0,
            image_count INTEGER DEFAULT 0,
            layout_type TEXT DEFAULT 'grid' CHECK(layout_type IN ('grid', 'masonry', 'mosaic', 'justified', 'carousel', 'fullscreen')),
            columns INTEGER DEFAULT 4,
            pagination_style TEXT DEFAULT 'load_more' CHECK(pagination_style IN ('numbered', 'load_more', 'infinite')),
            images_per_page INTEGER DEFAULT 24,
            show_image_info INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT DEFAULT NULL,
            FOREIGN KEY (parent_gallery_id) REFERENCES galleries(id) ON DELETE SET NULL
        )
    `).run();

    // Add image_count column if missing (migration for existing databases)
    try {
        db.prepare('ALTER TABLE galleries ADD COLUMN image_count INTEGER DEFAULT 0').run();
    } catch(e) { /* column already exists */ }

    // ─── IMAGES TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gallery_id INTEGER DEFAULT NULL,
            filename TEXT NOT NULL DEFAULT '',
            original_filename TEXT NOT NULL DEFAULT '',
            original_path TEXT NOT NULL DEFAULT '',
            thumbnail_path TEXT DEFAULT '',
            preview_path TEXT DEFAULT '',
            title TEXT DEFAULT '',
            description TEXT DEFAULT '',
            tags TEXT DEFAULT '',
            width INTEGER DEFAULT 0,
            height INTEGER DEFAULT 0,
            file_size INTEGER DEFAULT 0,
            format TEXT DEFAULT '',
            price REAL DEFAULT 10.00,
            license_type TEXT DEFAULT 'standard' CHECK(license_type IN ('standard', 'extended', 'editorial')),
            download_count INTEGER DEFAULT 0,
            view_count INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            uploaded_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE SET NULL
        )
    `).run();

    // Add storage_provider column for tiered storage
    try { db.prepare("ALTER TABLE images ADD COLUMN storage_provider TEXT DEFAULT 'local'").run(); } catch(e) { /* column may already exist */ }
    // Add gdrive_file_id column for backup reference
    try { db.prepare("ALTER TABLE images ADD COLUMN gdrive_file_id TEXT DEFAULT NULL").run(); } catch(e) { /* column may already exist */ }
    // ---- Ultra‑lite AI metadata columns ----
    // Dominant color (hex string), perceptual hash, and processing status
    try { db.prepare("ALTER TABLE images ADD COLUMN dominant_color TEXT DEFAULT NULL").run(); } catch(e) { /* column may already exist */ }
    try { db.prepare("ALTER TABLE images ADD COLUMN phash TEXT DEFAULT NULL").run(); } catch(e) { /* column may already exist */ }
    try { db.prepare("ALTER TABLE images ADD COLUMN ai_status TEXT DEFAULT 'pending'").run(); } catch(e) { /* column may already exist */ }
    // Create a simple background task queue table (persistent across restarts)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS background_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER NOT NULL,
            task_type TEXT NOT NULL,
            status TEXT DEFAULT 'queued', -- queued, processing, completed, failed
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )
    `).run();
    // ─── SUBSCRIPTIONS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            gateway TEXT NOT NULL,
            status TEXT NOT NULL, -- pending, active, cancelled, failed
            expires_at INTEGER NOT NULL, -- Unix timestamp
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `).run();

    // ─── IMAGE METADATA (EXIF) TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS image_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER UNIQUE NOT NULL,
            camera_make TEXT DEFAULT '',
            camera_model TEXT DEFAULT '',
            lens TEXT DEFAULT '',
            focal_length TEXT DEFAULT '',
            aperture TEXT DEFAULT '',
            shutter_speed TEXT DEFAULT '',
            iso TEXT DEFAULT '',
            white_balance TEXT DEFAULT '',
            flash TEXT DEFAULT '',
            color_space TEXT DEFAULT '',
            orientation INTEGER DEFAULT 1,
            gps_latitude REAL DEFAULT NULL,
            gps_longitude REAL DEFAULT NULL,
            gps_altitude REAL DEFAULT NULL,
            date_taken TEXT DEFAULT '',
            software TEXT DEFAULT '',
            copyright TEXT DEFAULT '',
            all_exif TEXT DEFAULT '{}',
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )
    `).run();

    // ─── PEOPLE TABLE (For tagging faces) ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `).run();

    // ─── FACE DESCRIPTORS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS face_descriptors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER NOT NULL,
            person_id INTEGER DEFAULT NULL,
            descriptor TEXT NOT NULL,
            bbox_x REAL DEFAULT 0,
            bbox_y REAL DEFAULT 0,
            bbox_w REAL DEFAULT 0,
            bbox_h REAL DEFAULT 0,
            confidence REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
            FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
        )
    `).run();

    // ─── SUBSCRIPTION PLANS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            price_monthly REAL NOT NULL,
            price_yearly REAL DEFAULT NULL,
            downloads_per_month INTEGER DEFAULT 0,
            max_resolution TEXT DEFAULT 'original',
            features TEXT DEFAULT '[]',
            is_active INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `).run();

    // ─── ORDERS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_number TEXT UNIQUE NOT NULL,
            total_amount REAL NOT NULL,
            currency TEXT DEFAULT 'MYR',
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded')),
            payment_gateway TEXT DEFAULT '',
            payment_ref TEXT DEFAULT '',
            payment_url TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            paid_at TEXT DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `).run();

    // ─── ORDER ITEMS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            image_id INTEGER NOT NULL,
            price REAL NOT NULL,
            license_type TEXT DEFAULT 'standard',
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )
    `).run();

    // ─── CART ITEMS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            image_id INTEGER NOT NULL,
            added_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, image_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )
    `).run();

    // ─── DOWNLOADS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            image_id INTEGER NOT NULL,
            order_id INTEGER DEFAULT NULL,
            subscription_id INTEGER DEFAULT NULL,
            downloaded_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
        )
    `).run();

    // ─── FAVORITES TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            image_id INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, image_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )
    `).run();

    // ─── COMMENTS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_approved INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `).run();

    // ─── PAYMENT SETTINGS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS payment_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gateway_name TEXT UNIQUE NOT NULL,
            display_name TEXT DEFAULT '',
            api_key TEXT DEFAULT '',
            secret_key TEXT DEFAULT '',
            extra_config TEXT DEFAULT '{}',
            is_sandbox INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `).run();

    // ─── SYSTEM SETTINGS TABLE ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `).run();

    // ─── PAGES TABLE (CMS) ───
    db.prepare(`
        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            layout_data TEXT DEFAULT '[]',
            is_published INTEGER DEFAULT 1,
            is_homepage INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `).run();

    // ─── CREATE INDEXES ───
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_images_gallery ON images(gallery_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_images_tags ON images(tags)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_face_image ON face_descriptors(image_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_face_person ON face_descriptors(person_id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_galleries_slug ON galleries(slug)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_galleries_parent ON galleries(parent_gallery_id)`).run();

    // ─── SEED DEFAULT DATA ───
    seedDefaults(db);

    return db;
}

function seedDefaults(db) {
    // Check if admin exists
    const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
    if (!adminExists) {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@photovault.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const hash = bcrypt.hashSync(adminPassword, 10);
        db.prepare(`
            INSERT INTO users (username, email, password_hash, full_name, role)
            VALUES (?, ?, ?, ?, ?)
        `).run('admin', adminEmail, hash, 'Administrator', 'admin');
        console.log(`✅ Admin user created: ${adminEmail}`);
    }

    // Seed subscription plans
    const plansExist = db.prepare('SELECT COUNT(*) as count FROM subscription_plans').get();
    if (plansExist.count === 0) {
        const plans = [
            { name: 'Free', desc: 'Browse & search only. No downloads.', price: 0, yearly: 0, downloads: 0, features: '["Browse galleries","Search images","View previews","Save favorites"]', order: 0 },
            { name: 'Basic', desc: '10 high-quality downloads per month.', price: 29, yearly: 290, downloads: 10, features: '["Everything in Free","10 downloads/month","Standard license","Email support"]', order: 1 },
            { name: 'Pro', desc: '50 downloads per month with extended license.', price: 79, yearly: 790, downloads: 50, features: '["Everything in Basic","50 downloads/month","Extended license","Priority support","EXIF metadata access"]', order: 2 },
            { name: 'Enterprise', desc: 'Unlimited downloads with full access.', price: 199, yearly: 1990, downloads: -1, features: '["Everything in Pro","Unlimited downloads","Commercial license","Dedicated support","API access","Custom watermark removal"]', order: 3 }
        ];
        const stmt = db.prepare(`
            INSERT INTO subscription_plans (name, description, price_monthly, price_yearly, downloads_per_month, features, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const plan of plans) {
            stmt.run(plan.name, plan.desc, plan.price, plan.yearly, plan.downloads, plan.features, plan.order);
        }
        console.log('✅ Subscription plans seeded');
    }

    // Seed payment settings
    const paymentsExist = db.prepare('SELECT COUNT(*) as count FROM payment_settings').get();
    if (paymentsExist.count === 0) {
        const gateways = [
            { name: 'toyyibpay', display: 'ToyyibPay', order: 1 },
            { name: 'billplz', display: 'Billplz', order: 2 },
            { name: 'stripe', display: 'Stripe', order: 3 }
        ];
        const stmt = db.prepare(`
            INSERT INTO payment_settings (gateway_name, display_name, sort_order)
            VALUES (?, ?, ?)
        `);
        for (const gw of gateways) {
            stmt.run(gw.name, gw.display, gw.order);
        }
        console.log('✅ Payment gateways seeded');
    }

    // Seed system settings
    const settingsExist = db.prepare('SELECT COUNT(*) as count FROM system_settings').get();
    if (settingsExist.count === 0) {
        const settings = {
            'site_name': 'PhotoVault',
            'site_tagline': 'Premium Stock Photos for Creative Professionals',
            'site_description': 'Discover and download high-quality stock photos. Professional photography for your creative projects.',
            'currency': 'MYR',
            'currency_symbol': 'RM',
            'watermark_text': 'PhotoVault',
            'watermark_opacity': '0.4',
            'watermark_custom_image': '',
            'default_image_price': '10.00',
            'allow_guest_browse': '1',
            'require_login_to_view': '0',
            'enable_comments': '1',
            'enable_favorites': '1',
            'enable_social_sharing': '1',
            'max_upload_size_mb': '100',
            'thumbnail_width': '400',
            'preview_width': '1200',
            'default_gallery_layout': 'masonry',
            'default_gallery_columns': '4',
            'items_per_page': '24'
        };
        const stmt = db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)');
        for (const [key, value] of Object.entries(settings)) {
            stmt.run(key, value);
        }
        console.log('✅ System settings seeded');
    }

    // Seed default CMS pages
    const pagesExist = db.prepare('SELECT COUNT(*) as count FROM pages').get();
    if (pagesExist.count === 0) {
        const defaultLayout = [
            {
                type: 'hero',
                title: 'Discover World-Class Professional Photos',
                subtitle: 'Download high-resolution, royalty-free images for your next creative project. Powered by AI face recognition.',
                badge: 'Premium Stock Photography'
            },
            {
                type: 'stats',
                items: [
                    { value: '100k+', label: 'High-Res Photos' },
                    { value: 'AI', label: 'Face Recognition' },
                    { value: '100%', label: 'Secure Payments' }
                ]
            },
            {
                type: 'gallery_grid',
                title: 'Featured Collections',
                limit: 6
            }
        ];

        db.prepare(`
            INSERT INTO pages (slug, title, layout_data, is_published, is_homepage)
            VALUES (?, ?, ?, ?, ?)
        `).run('home', 'Home', JSON.stringify(defaultLayout), 1, 1);
        console.log('✅ Default CMS homepage seeded');
    }

    // Ensure upload directories exist
    const dirs = [
        path.join(__dirname, '..', 'uploads', 'original'),
        path.join(__dirname, '..', 'uploads', 'thumbnails'),
        path.join(__dirname, '..', 'uploads', 'previews'),
        path.join(__dirname, '..', 'uploads', 'watermarks'),
        path.join(__dirname, '..', 'uploads', 'avatars')
    ];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
    }
}

module.exports = initDatabase;
