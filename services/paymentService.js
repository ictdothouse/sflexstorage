// services/paymentService.js
// Central dispatcher for payment gateway integration.
// Supports multiple gateways via plug‑in modules under services/gateways.

const path = require('path');
const Database = require('better-sqlite3');
const DB_PATH = path.join(__dirname, '..', 'database', 'photovault.db');
const db = new Database(DB_PATH);

// Load active gateway configuration from payment_settings table.
function getActiveGatewayConfig() {
  const row = db.prepare(`SELECT * FROM payment_settings WHERE is_active = 1`).get();
  if (!row) return null;
  return {
    name: row.gateway_name,
    displayName: row.display_name,
    apiKey: row.api_key,
    secretKey: row.secret_key,
    extraConfig: JSON.parse(row.extra_config || '{}'),
    isSandbox: !!row.is_sandbox
  };
}

// Dynamically require the gateway wrapper based on name.
function getGatewayModule(gatewayName) {
  try {
    // Wrapper files are located in services/gateways/<gateway>.js
    const modulePath = path.join(__dirname, 'gateways', `${gatewayName}.js`);
    // eslint-disable-next-line global-require
    return require(modulePath);
  } catch (e) {
    console.error('Failed to load gateway module:', gatewayName, e);
    return null;
  }
}

/**
 * Create a subscription for a user.
 * @param {number} userId - ID of the user buying the subscription.
 * @param {object} plan - Object describing the subscription plan (price, duration, etc.).
 * @returns {Promise<object>} - { paymentUrl, subscriptionId }
 */
async function createSubscription(userId, plan) {
  const cfg = getActiveGatewayConfig();
  if (!cfg) throw new Error('No active payment gateway configured');

  const gateway = getGatewayModule(cfg.name);
  if (!gateway || typeof gateway.createSubscription !== 'function') {
    throw new Error(`Gateway ${cfg.name} does not implement createSubscription`);
  }

  // Insert a pending subscription record.
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (plan.durationSeconds || 0);
  const insert = db.prepare(`INSERT INTO subscriptions (user_id, gateway, status, expires_at, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)`);
  const result = insert.run(userId, cfg.name, expiresAt, now, now);
  const subscriptionId = result.lastInsertRowid;

  // Let the gateway generate a payment URL / session.
  const paymentInfo = await gateway.createSubscription({
    apiKey: cfg.apiKey,
    secretKey: cfg.secretKey,
    isSandbox: cfg.isSandbox,
    extraConfig: cfg.extraConfig,
    userId,
    plan,
    subscriptionId
  });

  return { paymentUrl: paymentInfo.url, subscriptionId };
}

/**
 * Verify a webhook payload and update subscription status.
 * @param {string} gatewayName - Name of the gateway sending the webhook.
 * @param {object} req - Express request object.
 */
async function handleWebhook(gatewayName, req) {
  const gateway = getGatewayModule(gatewayName);
  if (!gateway || typeof gateway.verifyWebhook !== 'function') {
    throw new Error(`Gateway ${gatewayName} does not implement verifyWebhook`);
  }
  const payload = await gateway.verifyWebhook(req);
  const { subscriptionId, status, expiresAt } = payload;
  const update = db.prepare(`UPDATE subscriptions SET status = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?`);
  update.run(status, expiresAt, subscriptionId);
}

module.exports = { createSubscription, handleWebhook };
