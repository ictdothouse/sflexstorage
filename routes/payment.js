const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const PaymentGatewayManager = require('../services/paymentGateway');

module.exports = function(db) {
    const paymentManager = new PaymentGatewayManager(db);

    // ─── GET ACTIVE PAYMENT GATEWAYS ───
    router.get('/gateways', (req, res) => {
        try {
            const gateways = paymentManager.getActiveGateways();
            res.json({ gateways });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch gateways.' });
        }
    });

    // ─── CREATE PAYMENT ───
    router.post('/create', requireAuth, (req, res) => {
        try {
            const { order_id, gateway } = req.body;
            if (!order_id || !gateway) {
                return res.status(400).json({ error: 'order_id and gateway are required.' });
            }

            const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
                .get(order_id, req.session.userId);
            if (!order) return res.status(404).json({ error: 'Order not found.' });
            if (order.status === 'paid' || order.status === 'completed') {
                return res.status(400).json({ error: 'Order already paid.' });
            }

            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            paymentManager.createPayment(gateway, {
                amount: order.total_amount,
                description: `PhotoVault Order #${order.order_number}`,
                orderId: order.order_number,
                customerName: user.full_name || user.username,
                customerEmail: user.email,
                callbackUrl: `${baseUrl}/api/payment/callback/${gateway}`,
                returnUrl: `${baseUrl}/checkout.html?order=${order.id}&status=return`
            }).then(result => {
                if (result.success) {
                    db.prepare("UPDATE orders SET payment_gateway = ?, payment_ref = ?, payment_url = ?, updated_at = datetime('now') WHERE id = ?")
                        .run(gateway, result.paymentRef, result.paymentUrl, order.id);
                    res.json({ success: true, paymentUrl: result.paymentUrl, ref: result.paymentRef });
                } else {
                    res.status(400).json({ error: result.error || 'Payment creation failed.' });
                }
            }).catch(err => {
                console.error('Payment create error:', err);
                res.status(500).json({ error: 'Payment creation failed.' });
            });
        } catch (error) {
            console.error('Create payment error:', error);
            res.status(500).json({ error: 'Payment creation failed.' });
        }
    });

    // ─── PAYMENT CALLBACK/WEBHOOK ───
    router.post('/callback/:gateway', (req, res) => {
        try {
            const gateway = req.params.gateway;
            const data = { ...req.body, ...req.query };
            console.log(`Payment callback [${gateway}]:`, data);

            // Find order by reference
            let orderRef = data.billExternalReferenceNo || data.reference_1 || data.client_reference_id || '';
            let paymentRef = data.billcode || data.id || data.session_id || '';

            let order;
            if (orderRef) {
                order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderRef);
            }
            if (!order && paymentRef) {
                order = db.prepare('SELECT * FROM orders WHERE payment_ref = ?').get(paymentRef);
            }

            if (!order) {
                console.warn('Payment callback: Order not found', data);
                return res.status(200).send('OK'); // Return 200 to prevent retries
            }

            // Verify payment
            paymentManager.verifyPayment(gateway, order.payment_ref || paymentRef, data).then(result => {
                if (result.success && result.status === 'paid') {
                    // Mark order as paid
                    db.prepare(`
                        UPDATE orders SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now')
                        WHERE id = ?
                    `).run(order.id);

                    // Grant downloads
                    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
                    for (const item of items) {
                        // Check if download already recorded
                        const existing = db.prepare('SELECT id FROM downloads WHERE user_id = ? AND image_id = ? AND order_id = ?')
                            .get(order.user_id, item.image_id, order.id);
                        if (!existing) {
                            db.prepare('INSERT INTO downloads (user_id, image_id, order_id) VALUES (?, ?, ?)')
                                .run(order.user_id, item.image_id, order.id);
                            db.prepare('UPDATE images SET download_count = download_count + 1 WHERE id = ?')
                                .run(item.image_id);
                        }
                    }

                    // If subscription order, activate subscription
                    if (order.notes && order.notes.startsWith('Subscription:')) {
                        const planName = order.notes.replace('Subscription: ', '');
                        const plan = db.prepare('SELECT * FROM subscription_plans WHERE name = ?').get(planName);
                        if (plan) {
                            const now = new Date();
                            const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
                            db.prepare(`
                                UPDATE users SET
                                    subscription_plan_id = ?,
                                    subscription_start = ?,
                                    subscription_expiry = ?,
                                    downloads_used_this_cycle = 0,
                                    downloads_cycle_reset = ?
                                WHERE id = ?
                            `).run(plan.id, now.toISOString(), expiry.toISOString(), now.toISOString(), order.user_id);
                        }
                    }

                    // Clear cart
                    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(order.user_id);

                    console.log(`✅ Order ${order.order_number} paid successfully`);
                }
            });

            res.status(200).send('OK');
        } catch (error) {
            console.error('Payment callback error:', error);
            res.status(200).send('OK');
        }
    });

    // ─── VERIFY PAYMENT STATUS ───
    router.get('/verify/:orderId', requireAuth, (req, res) => {
        try {
            const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
                .get(req.params.orderId, req.session.userId);
            if (!order) return res.status(404).json({ error: 'Order not found.' });

            if (order.status === 'paid' || order.status === 'completed') {
                return res.json({ status: 'paid', order });
            }

            // Try to verify with gateway
            if (order.payment_gateway && order.payment_ref) {
                paymentManager.verifyPayment(order.payment_gateway, order.payment_ref, {}).then(result => {
                    if (result.success && result.status === 'paid') {
                        // Trigger same logic as callback
                        db.prepare("UPDATE orders SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(order.id);
                        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
                        for (const item of items) {
                            const existing = db.prepare('SELECT id FROM downloads WHERE user_id = ? AND image_id = ? AND order_id = ?')
                                .get(order.user_id, item.image_id, order.id);
                            if (!existing) {
                                db.prepare('INSERT INTO downloads (user_id, image_id, order_id) VALUES (?, ?, ?)').run(order.user_id, item.image_id, order.id);
                            }
                        }
                        db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(order.user_id);
                        res.json({ status: 'paid', order: { ...order, status: 'paid' } });
                    } else {
                        res.json({ status: order.status, order });
                    }
                }).catch(() => {
                    res.json({ status: order.status, order });
                });
            } else {
                res.json({ status: order.status, order });
            }
        } catch (error) {
            res.status(500).json({ error: 'Verification failed.' });
        }
    });

    // ─── SIMULATE PAYMENT (for testing without real gateway) ───
    router.post('/simulate/:orderId', requireAuth, (req, res) => {
        try {
            const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
                .get(req.params.orderId, req.session.userId);
            if (!order) return res.status(404).json({ error: 'Order not found.' });

            // Mark as paid
            db.prepare("UPDATE orders SET status = 'paid', paid_at = datetime('now'), payment_gateway = 'simulated', updated_at = datetime('now') WHERE id = ?").run(order.id);

            // Grant downloads
            const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
            for (const item of items) {
                const existing = db.prepare('SELECT id FROM downloads WHERE user_id = ? AND image_id = ? AND order_id = ?')
                    .get(order.user_id, item.image_id, order.id);
                if (!existing) {
                    db.prepare('INSERT INTO downloads (user_id, image_id, order_id) VALUES (?, ?, ?)')
                        .run(order.user_id, item.image_id, order.id);
                    db.prepare('UPDATE images SET download_count = download_count + 1 WHERE id = ?').run(item.image_id);
                }
            }

            // Handle subscription activation
            if (order.notes && order.notes.startsWith('Subscription:')) {
                const planName = order.notes.replace('Subscription: ', '');
                const plan = db.prepare('SELECT * FROM subscription_plans WHERE name = ?').get(planName);
                if (plan) {
                    const now = new Date();
                    const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                    db.prepare(`
                        UPDATE users SET subscription_plan_id = ?, subscription_start = ?,
                            subscription_expiry = ?, downloads_used_this_cycle = 0, downloads_cycle_reset = ?
                        WHERE id = ?
                    `).run(plan.id, now.toISOString(), expiry.toISOString(), now.toISOString(), order.user_id);
                }
            }

            // Clear cart
            db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(order.user_id);

            res.json({ success: true, status: 'paid', message: 'Payment simulated successfully.' });
        } catch (error) {
            console.error('Simulate payment error:', error);
            res.status(500).json({ error: 'Simulation failed.' });
        }
    });

    return router;
};
