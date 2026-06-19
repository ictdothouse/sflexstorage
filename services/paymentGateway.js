const axios = require('axios');

/**
 * Abstract Payment Gateway Interface
 * All gateways implement: createPayment, verifyPayment
 */

class PaymentGatewayManager {
    constructor(db) {
        this.db = db;
        this.gateways = {};
        this.loadGateways();
    }

    loadGateways() {
        const settings = this.db.prepare('SELECT * FROM payment_settings WHERE is_active = 1').all();
        for (const setting of settings) {
            switch (setting.gateway_name) {
                case 'toyyibpay':
                    this.gateways.toyyibpay = new ToyyibPayGateway(setting);
                    break;
                case 'billplz':
                    this.gateways.billplz = new BillplzGateway(setting);
                    break;
                case 'stripe':
                    this.gateways.stripe = new StripeGateway(setting);
                    break;
                default:
                    console.warn(`Unknown gateway: ${setting.gateway_name}`);
            }
        }
    }

    reload() {
        this.gateways = {};
        this.loadGateways();
    }

    getActiveGateways() {
        return Object.entries(this.gateways).map(([name, gw]) => ({
            name,
            displayName: gw.displayName,
            isActive: true
        }));
    }

    getGateway(name) {
        return this.gateways[name] || null;
    }

    async createPayment(gatewayName, paymentData) {
        const gateway = this.getGateway(gatewayName);
        if (!gateway) throw new Error(`Payment gateway '${gatewayName}' not found or not active`);
        return await gateway.createPayment(paymentData);
    }

    async verifyPayment(gatewayName, paymentRef, data) {
        const gateway = this.getGateway(gatewayName);
        if (!gateway) throw new Error(`Payment gateway '${gatewayName}' not found`);
        return await gateway.verifyPayment(paymentRef, data);
    }
}

// ─── TOYYIBPAY GATEWAY ───
class ToyyibPayGateway {
    constructor(settings) {
        this.displayName = settings.display_name || 'ToyyibPay';
        this.secretKey = settings.secret_key || '';
        this.categoryCode = '';
        this.isSandbox = !!settings.is_sandbox;
        this.baseUrl = this.isSandbox
            ? 'https://dev.toyyibpay.com'
            : 'https://toyyibpay.com';

        try {
            const extra = JSON.parse(settings.extra_config || '{}');
            this.categoryCode = extra.category_code || '';
        } catch (e) {}
    }

    async createPayment({ amount, description, orderId, customerName, customerEmail, callbackUrl, returnUrl }) {
        try {
            const formData = new URLSearchParams();
            formData.append('userSecretKey', this.secretKey);
            formData.append('categoryCode', this.categoryCode);
            formData.append('billName', description || `Order #${orderId}`);
            formData.append('billDescription', `Payment for Order #${orderId}`);
            formData.append('billPriceSetting', 1);
            formData.append('billPayorInfo', 1);
            formData.append('billAmount', Math.round(amount * 100)); // in cents
            formData.append('billReturnUrl', returnUrl);
            formData.append('billCallbackUrl', callbackUrl);
            formData.append('billExternalReferenceNo', orderId);
            formData.append('billTo', customerName || 'Customer');
            formData.append('billEmail', customerEmail || '');
            formData.append('billPaymentChannel', '0'); // Both FPX & CC

            const response = await axios.post(`${this.baseUrl}/index.php/api/createBill`, formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const billCode = response.data[0]?.BillCode || response.data;
            return {
                success: true,
                paymentUrl: `${this.baseUrl}/${billCode}`,
                paymentRef: String(billCode),
                gateway: 'toyyibpay'
            };
        } catch (error) {
            console.error('ToyyibPay error:', error.message);
            return { success: false, error: error.message, gateway: 'toyyibpay' };
        }
    }

    async verifyPayment(paymentRef, callbackData = {}) {
        try {
            // ToyyibPay sends callback with status
            // status_id: 1 = success, 2 = pending, 3 = failed
            const statusId = callbackData.status_id || callbackData.statusId;
            if (statusId == 1) {
                return { success: true, status: 'paid', ref: paymentRef };
            }
            // Also try API verification
            const formData = new URLSearchParams();
            formData.append('billCode', paymentRef);
            const response = await axios.post(`${this.baseUrl}/index.php/api/getBillTransactions`, formData);
            const transactions = response.data;
            if (Array.isArray(transactions) && transactions.length > 0) {
                const paid = transactions.find(t => t.billpaymentStatus === '1');
                if (paid) return { success: true, status: 'paid', ref: paymentRef };
            }
            return { success: false, status: 'pending', ref: paymentRef };
        } catch (error) {
            return { success: false, status: 'error', error: error.message };
        }
    }
}

// ─── BILLPLZ GATEWAY ───
class BillplzGateway {
    constructor(settings) {
        this.displayName = settings.display_name || 'Billplz';
        this.apiKey = settings.api_key || '';
        this.collectionId = '';
        this.isSandbox = !!settings.is_sandbox;
        this.baseUrl = this.isSandbox
            ? 'https://www.billplz-sandbox.com/api/v3'
            : 'https://www.billplz.com/api/v3';

        try {
            const extra = JSON.parse(settings.extra_config || '{}');
            this.collectionId = extra.collection_id || '';
        } catch (e) {}
    }

    async createPayment({ amount, description, orderId, customerName, customerEmail, callbackUrl, returnUrl }) {
        try {
            const auth = Buffer.from(`${this.apiKey}:`).toString('base64');
            const response = await axios.post(`${this.baseUrl}/bills`, {
                collection_id: this.collectionId,
                description: description || `Order #${orderId}`,
                email: customerEmail || 'customer@example.com',
                name: customerName || 'Customer',
                amount: Math.round(amount * 100), // in cents
                callback_url: callbackUrl,
                redirect_url: returnUrl,
                reference_1_label: 'Order ID',
                reference_1: orderId
            }, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                paymentUrl: response.data.url,
                paymentRef: response.data.id,
                gateway: 'billplz'
            };
        } catch (error) {
            console.error('Billplz error:', error.response?.data || error.message);
            return { success: false, error: error.message, gateway: 'billplz' };
        }
    }

    async verifyPayment(paymentRef, callbackData = {}) {
        try {
            const auth = Buffer.from(`${this.apiKey}:`).toString('base64');
            const response = await axios.get(`${this.baseUrl}/bills/${paymentRef}`, {
                headers: { 'Authorization': `Basic ${auth}` }
            });
            const bill = response.data;
            if (bill.paid) {
                return { success: true, status: 'paid', ref: paymentRef };
            }
            return { success: false, status: 'pending', ref: paymentRef };
        } catch (error) {
            return { success: false, status: 'error', error: error.message };
        }
    }
}

// ─── STRIPE GATEWAY ───
class StripeGateway {
    constructor(settings) {
        this.displayName = settings.display_name || 'Stripe';
        this.secretKey = settings.secret_key || '';
        this.publishableKey = settings.api_key || '';
        this.isSandbox = !!settings.is_sandbox;
        this.baseUrl = 'https://api.stripe.com/v1';
    }

    async createPayment({ amount, description, orderId, customerEmail, callbackUrl, returnUrl }) {
        try {
            const auth = Buffer.from(`${this.secretKey}:`).toString('base64');
            const formData = new URLSearchParams();
            formData.append('payment_method_types[]', 'card');
            formData.append('line_items[0][price_data][currency]', 'myr');
            formData.append('line_items[0][price_data][product_data][name]', description || `Order #${orderId}`);
            formData.append('line_items[0][price_data][unit_amount]', Math.round(amount * 100));
            formData.append('line_items[0][quantity]', '1');
            formData.append('mode', 'payment');
            formData.append('success_url', `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`);
            formData.append('cancel_url', returnUrl);
            formData.append('client_reference_id', orderId);
            if (customerEmail) formData.append('customer_email', customerEmail);
            formData.append('metadata[order_id]', orderId);

            const response = await axios.post(`${this.baseUrl}/checkout/sessions`, formData, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return {
                success: true,
                paymentUrl: response.data.url,
                paymentRef: response.data.id,
                gateway: 'stripe'
            };
        } catch (error) {
            console.error('Stripe error:', error.response?.data || error.message);
            return { success: false, error: error.message, gateway: 'stripe' };
        }
    }

    async verifyPayment(paymentRef) {
        try {
            const auth = Buffer.from(`${this.secretKey}:`).toString('base64');
            const response = await axios.get(`${this.baseUrl}/checkout/sessions/${paymentRef}`, {
                headers: { 'Authorization': `Basic ${auth}` }
            });
            if (response.data.payment_status === 'paid') {
                return { success: true, status: 'paid', ref: paymentRef };
            }
            return { success: false, status: response.data.payment_status, ref: paymentRef };
        } catch (error) {
            return { success: false, status: 'error', error: error.message };
        }
    }
}

module.exports = PaymentGatewayManager;
