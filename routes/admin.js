const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

module.exports = function(db) {
    // All routes in this file require admin access
    router.use(requireAdmin);

    // ─── DASHBOARD STATS ───
    router.get('/stats', (req, res) => {
        try {
            const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
            const galleries = db.prepare('SELECT COUNT(*) as count FROM galleries').get().count;
            const images = db.prepare('SELECT COUNT(*) as count FROM images').get().count;
            const orders = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status = 'paid' OR status = 'completed'").get();
            const downloads = db.prepare('SELECT COUNT(*) as count FROM downloads').get().count;

            // Monthly revenue
            const monthlyRevenue = db.prepare(`
                SELECT strftime('%Y-%m', created_at) as month, SUM(total_amount) as total
                FROM orders
                WHERE status IN ('paid', 'completed') AND created_at >= date('now', '-11 months')
                GROUP BY month
                ORDER BY month ASC
            `).all();

            res.json({
                success: true,
                stats: {
                    totalUsers: users,
                    totalGalleries: galleries,
                    totalImages: images,
                    totalOrders: orders.count,
                    totalRevenue: orders.revenue,
                    totalDownloads: downloads
                },
                monthlyRevenue
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch stats.' });
        }
    });

    // ─── USER MANAGEMENT ───
    router.get('/users', (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
            const users = db.prepare(`
                SELECT u.id, u.username, u.email, u.full_name, u.role, u.created_at, u.is_active,
                       sp.name as plan_name,
                       (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
                       (SELECT COUNT(*) FROM downloads WHERE user_id = u.id) as download_count
                FROM users u
                LEFT JOIN subscription_plans sp ON u.subscription_plan_id = sp.id
                ORDER BY u.created_at DESC
                LIMIT ? OFFSET ?
            `).all(limit, offset);

            res.json({ users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch users.' });
        }
    });

    router.get('/users/:id', (req, res) => {
        try {
            const user = db.prepare(`
                SELECT u.id, u.username, u.email, u.full_name, u.role, u.created_at, u.is_active,
                       u.subscription_plan_id, u.subscription_start, u.subscription_expiry,
                       u.downloads_used_this_cycle, u.downloads_cycle_reset,
                       sp.name as plan_name, sp.downloads_per_month
                FROM users u
                LEFT JOIN subscription_plans sp ON u.subscription_plan_id = sp.id
                WHERE u.id = ?
            `).get(req.params.id);

            if (!user) return res.status(404).json({ error: 'User not found.' });

            const orders = db.prepare(`
                SELECT id, order_number, total_amount, status, created_at, payment_gateway
                FROM orders
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            `).all(user.id);

            res.json({ user, orders });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch user details.' });
        }
    });

    // ─── ORDER MANAGEMENT ───
    router.get('/orders', (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;
            const status = req.query.status || '';

            let query = 'SELECT o.*, u.username, u.email FROM orders o JOIN users u ON o.user_id = u.id';
            let params = [];

            if (status) {
                query += ' WHERE o.status = ?';
                params.push(status);
            }

            query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const countQuery = status ? 'SELECT COUNT(*) as count FROM orders WHERE status = ?' : 'SELECT COUNT(*) as count FROM orders';
            const total = db.prepare(countQuery).get(...(status ? [status] : [])).count;

            const orders = db.prepare(query).all(...params);

            res.json({ orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch orders.' });
        }
    });

    router.put('/orders/:id/status', (req, res) => {
        try {
            const { status } = req.body;
            db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update order status.' });
        }
    });

    // ─── SYSTEM SETTINGS ───
    router.get('/settings', (req, res) => {
        try {
            const settings = db.prepare('SELECT * FROM system_settings').all();
            const config = {};
            for (const s of settings) config[s.key] = s.value;
            res.json({ success: true, settings: config });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch settings.' });
        }
    });

    router.put('/settings', (req, res) => {
        try {
            const settings = req.body;
            const updateStmt = db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");
            
            db.transaction(() => {
                for (const [key, value] of Object.entries(settings)) {
                    updateStmt.run(key, String(value));
                }
            })();

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update settings.' });
        }
    });


    // ─── SUBSCRIPTION PLANS MANAGEMENT ───
    router.get('/subscription-plans', (req, res) => {
        try {
            const plans = db.prepare('SELECT * FROM subscription_plans ORDER BY sort_order').all();
            if (plans) {
                plans.forEach(p => {
                    if (p.features) {
                        try { p.features = JSON.parse(p.features); } catch (e) { p.features = []; }
                    }
                });
            }
            res.json({ success: true, plans });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch subscription plans.' });
        }
    });

    router.post('/subscription-plans', (req, res) => {
        try {
            const { name, description, price_monthly, price_yearly, downloads_per_month, features, is_active, sort_order } = req.body;
            const featuresJson = Array.isArray(features) ? JSON.stringify(features) : JSON.stringify([]);

            const result = db.prepare(`
                INSERT INTO subscription_plans (name, description, price_monthly, price_yearly, downloads_per_month, features, is_active, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(name, description, price_monthly, price_yearly, downloads_per_month, featuresJson, is_active === undefined ? 1 : is_active, sort_order || 0);
            
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (error) {
            res.status(500).json({ error: 'Failed to create subscription plan.' });
        }
    });

    router.put('/subscription-plans/:id', (req, res) => {
        try {
            const { name, description, price_monthly, price_yearly, downloads_per_month, features, is_active, sort_order } = req.body;
            const featuresJson = Array.isArray(features) ? JSON.stringify(features) : JSON.stringify([]);

            db.prepare(`
                UPDATE subscription_plans SET
                    name = ?, description = ?, price_monthly = ?, price_yearly = ?, 
                    downloads_per_month = ?, features = ?, is_active = ?, sort_order = ?, updated_at = datetime('now')
                WHERE id = ?
            `).run(name, description, price_monthly, price_yearly, downloads_per_month, featuresJson, is_active === undefined ? 1 : is_active, sort_order || 0, req.params.id);
            
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update subscription plan.' });
        }
    });

    router.delete('/subscription-plans/:id', (req, res) => {
        try {
            // Soft delete or real delete? Let's do real delete for simplicity but usually soft delete is better.
            db.prepare('DELETE FROM subscription_plans WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete subscription plan.' });
        }
    });

    // ─── PAYMENT GATEWAY SETTINGS ───
    const DEFAULT_GATEWAYS = [
        { gateway_name: 'toyyibpay', display_name: 'ToyyibPay', extra_config: JSON.stringify({ category_code: '', return_url: '', callback_url: '' }) },
        { gateway_name: 'billplz', display_name: 'Billplz', extra_config: JSON.stringify({ collection_id: '', x_signature: '' }) },
        { gateway_name: 'chip', display_name: 'Chip (Chip-In)', extra_config: JSON.stringify({ brand_id: '', callback_url: '' }) },
        { gateway_name: 'bcl', display_name: 'BCL (Bank Central)', extra_config: JSON.stringify({ merchant_id: '', return_url: '' }) },
        { gateway_name: 'stripe', display_name: 'Stripe', extra_config: JSON.stringify({ publishable_key: '', webhook_secret: '' }) }
    ];

    // Seed defaults if table is empty
    const seedPaymentGateways = () => {
        DEFAULT_GATEWAYS.forEach(gw => {
            const existing = db.prepare('SELECT id FROM payment_settings WHERE gateway_name = ?').get(gw.gateway_name);
            if (!existing) {
                db.prepare(`INSERT INTO payment_settings (gateway_name, display_name, api_key, secret_key, extra_config, is_sandbox, is_active) VALUES (?, ?, '', '', ?, 1, 0)`)
                    .run(gw.gateway_name, gw.display_name, gw.extra_config);
            }
        });
    };
    try { seedPaymentGateways(); } catch(e) { console.warn('Could not seed payment gateways:', e.message); }

    router.get('/payment-settings', (req, res) => {
        try {
            const gateways = db.prepare('SELECT * FROM payment_settings ORDER BY id').all();
            res.json({ success: true, gateways });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch payment settings.' });
        }
    });

    router.put('/payment-settings/:gateway', (req, res) => {
        try {
            const { api_key, secret_key, extra_config, is_sandbox, is_active } = req.body;
            const gatewayName = req.params.gateway;

            db.prepare(`
                UPDATE payment_settings SET
                    api_key = ?, secret_key = ?, extra_config = ?,
                    is_sandbox = ?, is_active = ?, updated_at = datetime('now')
                WHERE gateway_name = ?
            `).run(
                api_key || '', secret_key || '',
                typeof extra_config === 'string' ? extra_config : JSON.stringify(extra_config || {}),
                is_sandbox ? 1 : 0, is_active ? 1 : 0, gatewayName
            );

            // If activating this gateway, deactivate all others
            if (is_active) {
                db.prepare('UPDATE payment_settings SET is_active = 0 WHERE gateway_name != ?').run(gatewayName);
            }

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update payment settings.' });
        }
    });

    return router;
};
