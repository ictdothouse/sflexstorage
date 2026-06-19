const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

module.exports = function(db) {

    // ─── GET SUBSCRIPTION PLANS ───
    router.get('/plans', (req, res) => {
        try {
            const plans = db.prepare('SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order').all();
            for (const plan of plans) {
                try { plan.features = JSON.parse(plan.features); } catch (e) { plan.features = []; }
            }
            res.json({ plans });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch plans.' });
        }
    });

    // ─── GET CURRENT SUBSCRIPTION STATUS ───
    router.get('/status', requireAuth, (req, res) => {
        try {
            const user = db.prepare(`
                SELECT u.subscription_plan_id, u.subscription_start, u.subscription_expiry,
                       u.downloads_used_this_cycle, u.downloads_cycle_reset,
                       sp.name as plan_name, sp.downloads_per_month, sp.price_monthly
                FROM users u
                LEFT JOIN subscription_plans sp ON u.subscription_plan_id = sp.id
                WHERE u.id = ?
            `).get(req.session.userId);

            if (!user.subscription_plan_id) {
                return res.json({ active: false, plan: null });
            }

            const isExpired = user.subscription_expiry && new Date(user.subscription_expiry) < new Date();
            res.json({
                active: !isExpired,
                plan: {
                    id: user.subscription_plan_id,
                    name: user.plan_name,
                    price: user.price_monthly,
                    downloads_limit: user.downloads_per_month,
                    downloads_used: user.downloads_used_this_cycle,
                    downloads_remaining: user.downloads_per_month === -1 ? 'unlimited' : Math.max(0, user.downloads_per_month - user.downloads_used_this_cycle),
                    start: user.subscription_start,
                    expiry: user.subscription_expiry,
                    cycle_reset: user.downloads_cycle_reset
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch subscription status.' });
        }
    });

    // ─── SUBSCRIBE TO PLAN ───
    router.post('/subscribe', requireAuth, (req, res) => {
        try {
            const { plan_id, payment_gateway } = req.body;
            const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ? AND is_active = 1').get(plan_id);
            if (!plan) return res.status(404).json({ error: 'Plan not found.' });

            // Free plan - activate immediately
            if (plan.price_monthly === 0) {
                const now = new Date().toISOString();
                db.prepare(`
                    UPDATE users SET
                        subscription_plan_id = ?,
                        subscription_start = ?,
                        subscription_expiry = NULL,
                        downloads_used_this_cycle = 0,
                        downloads_cycle_reset = ?
                    WHERE id = ?
                `).run(plan.id, now, now, req.session.userId);

                return res.json({ success: true, activated: true, plan: plan.name });
            }

            // Paid plan - create order for subscription
            const orderNumber = `SUB-${Date.now()}`;
            const orderResult = db.prepare(`
                INSERT INTO orders (user_id, order_number, total_amount, payment_gateway, status, notes)
                VALUES (?, ?, ?, ?, 'pending', ?)
            `).run(
                req.session.userId, orderNumber, plan.price_monthly,
                payment_gateway || 'manual',
                `Subscription: ${plan.name}`
            );

            res.json({
                success: true,
                activated: false,
                order: {
                    id: orderResult.lastInsertRowid,
                    order_number: orderNumber,
                    total: plan.price_monthly,
                    plan: plan.name
                }
            });
        } catch (error) {
            console.error('Subscribe error:', error);
            res.status(500).json({ error: 'Subscription failed.' });
        }
    });

    // ─── CANCEL SUBSCRIPTION ───
    router.post('/cancel', requireAuth, (req, res) => {
        try {
            db.prepare(`
                UPDATE users SET
                    subscription_plan_id = NULL,
                    subscription_expiry = datetime('now')
                WHERE id = ?
            `).run(req.session.userId);
            res.json({ success: true, message: 'Subscription cancelled.' });
        } catch (error) {
            res.status(500).json({ error: 'Cancellation failed.' });
        }
    });

    return router;
};
