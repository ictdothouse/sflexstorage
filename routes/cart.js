const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

module.exports = function(db) {

    // ─── GET CART ───
    router.get('/', requireAuth, (req, res) => {
        try {
            const items = db.prepare(`
                SELECT ci.id as cart_item_id, ci.added_at,
                       i.id, i.title, i.thumbnail_path, i.preview_path, i.price,
                       i.width, i.height, i.license_type,
                       g.title as gallery_title
                FROM cart_items ci
                JOIN images i ON ci.image_id = i.id
                LEFT JOIN galleries g ON i.gallery_id = g.id
                WHERE ci.user_id = ? AND i.is_active = 1
                ORDER BY ci.added_at DESC
            `).all(req.session.userId);

            const total = items.reduce((sum, item) => sum + item.price, 0);
            res.json({ items, total: Math.round(total * 100) / 100, count: items.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch cart.' });
        }
    });

    // ─── ADD TO CART ───
    router.post('/add', requireAuth, (req, res) => {
        try {
            const { image_id } = req.body;
            if (!image_id) return res.status(400).json({ error: 'image_id required.' });

            // Check image exists
            const image = db.prepare('SELECT id, price FROM images WHERE id = ? AND is_active = 1').get(image_id);
            if (!image) return res.status(404).json({ error: 'Image not found.' });

            // Check if already purchased
            const downloaded = db.prepare('SELECT id FROM downloads WHERE user_id = ? AND image_id = ?')
                .get(req.session.userId, image_id);
            if (downloaded) return res.status(400).json({ error: 'You already own this image.' });

            // Check if already in cart
            const existing = db.prepare('SELECT id FROM cart_items WHERE user_id = ? AND image_id = ?')
                .get(req.session.userId, image_id);
            if (existing) return res.status(400).json({ error: 'Image already in cart.' });

            db.prepare('INSERT INTO cart_items (user_id, image_id) VALUES (?, ?)').run(req.session.userId, image_id);

            const count = db.prepare('SELECT COUNT(*) as count FROM cart_items WHERE user_id = ?').get(req.session.userId);
            res.json({ success: true, cartCount: count.count });
        } catch (error) {
            res.status(500).json({ error: 'Failed to add to cart.' });
        }
    });

    // ─── REMOVE FROM CART ───
    router.delete('/remove/:imageId', requireAuth, (req, res) => {
        try {
            db.prepare('DELETE FROM cart_items WHERE user_id = ? AND image_id = ?')
                .run(req.session.userId, req.params.imageId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to remove from cart.' });
        }
    });

    // ─── CLEAR CART ───
    router.delete('/clear', requireAuth, (req, res) => {
        try {
            db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.session.userId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to clear cart.' });
        }
    });

    // ─── CHECKOUT ───
    router.post('/checkout', requireAuth, (req, res) => {
        try {
            const { payment_gateway } = req.body;

            // Get cart items
            const items = db.prepare(`
                SELECT ci.*, i.id as image_id, i.title, i.price, i.license_type
                FROM cart_items ci
                JOIN images i ON ci.image_id = i.id
                WHERE ci.user_id = ? AND i.is_active = 1
            `).all(req.session.userId);

            if (items.length === 0) return res.status(400).json({ error: 'Cart is empty.' });

            const total = items.reduce((sum, item) => sum + item.price, 0);
            const orderNumber = `PV-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`;

            // Create order
            const orderResult = db.prepare(`
                INSERT INTO orders (user_id, order_number, total_amount, payment_gateway, status)
                VALUES (?, ?, ?, ?, 'pending')
            `).run(req.session.userId, orderNumber, Math.round(total * 100) / 100, payment_gateway || 'manual');

            // Create order items
            const insertItem = db.prepare('INSERT INTO order_items (order_id, image_id, price, license_type) VALUES (?, ?, ?, ?)');
            for (const item of items) {
                insertItem.run(orderResult.lastInsertRowid, item.image_id, item.price, item.license_type);
            }

            res.json({
                success: true,
                order: {
                    id: orderResult.lastInsertRowid,
                    order_number: orderNumber,
                    total: Math.round(total * 100) / 100,
                    items: items.length,
                    payment_gateway: payment_gateway || 'manual',
                    status: 'pending'
                }
            });
        } catch (error) {
            console.error('Checkout error:', error);
            res.status(500).json({ error: 'Checkout failed.' });
        }
    });

    // ─── GET CART COUNT ───
    router.get('/count', (req, res) => {
        if (!req.session.userId) return res.json({ count: 0 });
        const result = db.prepare('SELECT COUNT(*) as count FROM cart_items WHERE user_id = ?')
            .get(req.session.userId);
        res.json({ count: result.count });
    });

    return router;
};
