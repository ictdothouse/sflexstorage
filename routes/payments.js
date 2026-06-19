// routes/payments.js
// Payment related API endpoints.

const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');

// In a real app, you'd validate user authentication. Here we assume req.session.userId exists.

/**
 * Initiate a subscription purchase.
 * Expects JSON: { planId }
 */
router.post('/subscribe', async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    const { planId } = req.body;
    // For simplicity, fetch a static plan. In a full app, query subscription_plans table.
    const plan = { id: planId, price: 10.0, durationSeconds: 30 * 24 * 60 * 60, name: 'Monthly' };

    const { paymentUrl, subscriptionId } = await paymentService.createSubscription(userId, plan);
    // Return URL for client to redirect.
    res.json({ success: true, paymentUrl, subscriptionId });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Webhook endpoint for payment gateways.
 * URL: /api/payments/webhook/:gateway
 */
router.post('/webhook/:gateway', async (req, res) => {
  const { gateway } = req.params;
  try {
    await paymentService.handleWebhook(gateway, req);
    // Respond quickly to webhook source.
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Check subscription status.
 * GET /api/payments/status/:id
 */
router.get('/status/:id', (req, res) => {
  const subId = req.params.id;
  const db = require('better-sqlite3')(require('path').join(__dirname, '..', 'database', 'photovault.db'));
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });
  res.json({ subscription: sub });
});

module.exports = router;
