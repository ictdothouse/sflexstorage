const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = function(db) {
    // ─── REGISTER ───
    router.post('/register', async (req, res) => {
        try {
            const { username, email, password, full_name } = req.body;
            if (!username || !email || !password) {
                return res.status(400).json({ error: 'Username, email, and password are required.' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters.' });
            }
            // Check existing
            const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
            if (existing) {
                return res.status(400).json({ error: 'Email or username already registered.' });
            }
            const hash = await bcrypt.hash(password, 10);
            const result = db.prepare(`
                INSERT INTO users (username, email, password_hash, full_name)
                VALUES (?, ?, ?, ?)
            `).run(username, email.toLowerCase(), hash, full_name || '');

            // Auto-login after register
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.email = user.email;
            req.session.userRole = user.role;
            req.session.fullName = user.full_name;

            res.status(201).json({
                success: true,
                user: { id: user.id, username: user.username, email: user.email, role: user.role, full_name: user.full_name }
            });
        } catch (error) {
            console.error('Register error:', error);
            res.status(500).json({ error: 'Registration failed.' });
        }
    });

    // ─── LOGIN (accepts username OR email) ───
    router.post('/login', async (req, res) => {
        try {
            const { username, email, password } = req.body;
            const identifier = (username || email || '').trim();

            if (!identifier || !password) {
                return res.status(400).json({ error: 'Username/email and password are required.' });
            }

            // Search by username OR email (case-insensitive)
            const user = db.prepare(`
                SELECT * FROM users 
                WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) 
                AND is_active = 1
            `).get(identifier, identifier);

            if (!user) {
                return res.status(401).json({ error: 'Invalid username/email or password.' });
            }

            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) {
                return res.status(401).json({ error: 'Invalid username/email or password.' });
            }

            // Regenerate session to prevent session fixation attacks
            req.session.regenerate((err) => {
                if (err) return res.status(500).json({ error: 'Session error.' });

                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.email = user.email;
                req.session.userRole = user.role;
                req.session.fullName = user.full_name;

                req.session.save((saveErr) => {
                    if (saveErr) {
                        console.error('[login] Session save error:', saveErr);
                        return res.status(500).json({ error: 'Session save error.' });
                    }
                    console.log('[login] Session saved, sessionID:', req.sessionID, 'userId:', req.session.userId);
                    res.json({
                        success: true,
                        user: {
                            id: user.id, username: user.username, email: user.email,
                            role: user.role, full_name: user.full_name,
                            avatar: user.avatar, subscription_plan_id: user.subscription_plan_id
                        }
                    });
                });
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Login failed.' });
        }
    });

    // ─── LOGOUT ───
    router.post('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ error: 'Logout failed.' });
            res.json({ success: true });
        });
    });

    // ─── GET CURRENT USER ───
    router.get('/me', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        console.log('[/me] sessionID:', req.sessionID);
        console.log('[/me] session.userId:', req.session?.userId);
        console.log('[/me] cookies:', req.headers.cookie ? 'present' : 'MISSING');
        if (!req.session.userId) {
            return res.json({ authenticated: false, user: null });
        }
        const user = db.prepare(`
            SELECT u.*, sp.name as plan_name, sp.downloads_per_month
            FROM users u
            LEFT JOIN subscription_plans sp ON u.subscription_plan_id = sp.id
            WHERE u.id = ?
        `).get(req.session.userId);

        if (!user) {
            return res.json({ authenticated: false, user: null });
        }
        res.json({
            authenticated: true,
            user: {
                id: user.id, username: user.username, email: user.email,
                full_name: user.full_name, role: user.role, avatar: user.avatar,
                phone: user.phone, address: user.address,
                subscription: {
                    plan_id: user.subscription_plan_id,
                    plan_name: user.plan_name,
                    expiry: user.subscription_expiry,
                    downloads_used: user.downloads_used_this_cycle,
                    downloads_limit: user.downloads_per_month
                },
                created_at: user.created_at
            }
        });
    });

    // ─── UPDATE PROFILE ───
    router.put('/profile', async (req, res) => {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated.' });
        try {
            const { full_name, phone, address, username } = req.body;
            const updates = [];
            const params = [];

            if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
            if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
            if (address !== undefined) { updates.push('address = ?'); params.push(address); }
            if (username) {
                const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.session.userId);
                if (existing) return res.status(400).json({ error: 'Username already taken.' });
                updates.push('username = ?'); params.push(username);
            }

            if (updates.length === 0) return res.status(400).json({ error: 'No fields to update.' });

            updates.push("updated_at = datetime('now')");
            params.push(req.session.userId);

            db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

            if (username) req.session.username = username;
            if (full_name) req.session.fullName = full_name;

            res.json({ success: true, message: 'Profile updated.' });
        } catch (error) {
            console.error('Profile update error:', error);
            res.status(500).json({ error: 'Update failed.' });
        }
    });

    // ─── CHANGE PASSWORD ───
    router.put('/password', async (req, res) => {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated.' });
        try {
            const { current_password, new_password } = req.body;
            if (!current_password || !new_password) {
                return res.status(400).json({ error: 'Current and new password required.' });
            }
            if (new_password.length < 6) {
                return res.status(400).json({ error: 'New password must be at least 6 characters.' });
            }
            const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
            const match = await bcrypt.compare(current_password, user.password_hash);
            if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

            const hash = await bcrypt.hash(new_password, 10);
            db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.session.userId);
            res.json({ success: true, message: 'Password changed.' });
        } catch (error) {
            res.status(500).json({ error: 'Password change failed.' });
        }
    });

    // ─── GET USER'S DOWNLOAD HISTORY ───
    router.get('/downloads', (req, res) => {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated.' });
        const downloads = db.prepare(`
            SELECT d.*, i.title, i.thumbnail_path, i.filename, g.title as gallery_title
            FROM downloads d
            JOIN images i ON d.image_id = i.id
            LEFT JOIN galleries g ON i.gallery_id = g.id
            WHERE d.user_id = ?
            ORDER BY d.downloaded_at DESC
        `).all(req.session.userId);
        res.json({ downloads });
    });

    // ─── GET USER'S ORDER HISTORY ───
    router.get('/orders', (req, res) => {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated.' });
        const orders = db.prepare(`
            SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC
        `).all(req.session.userId);

        // Attach items to each order
        const getItems = db.prepare(`
            SELECT oi.*, i.title, i.thumbnail_path
            FROM order_items oi
            JOIN images i ON oi.image_id = i.id
            WHERE oi.order_id = ?
        `);
        for (const order of orders) {
            order.items = getItems.all(order.id);
        }
        res.json({ orders });
    });

    // ─── GET USER'S FAVORITES ───
    router.get('/favorites', (req, res) => {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated.' });
        const favorites = db.prepare(`
            SELECT f.id as favorite_id, f.created_at as favorited_at,
                   i.id, i.title, i.thumbnail_path, i.preview_path, i.price, i.tags,
                   g.title as gallery_title, g.slug as gallery_slug
            FROM favorites f
            JOIN images i ON f.image_id = i.id
            LEFT JOIN galleries g ON i.gallery_id = g.id
            WHERE f.user_id = ? AND i.is_active = 1
            ORDER BY f.created_at DESC
        `).all(req.session.userId);
        res.json({ favorites });
    });

    return router;
};
