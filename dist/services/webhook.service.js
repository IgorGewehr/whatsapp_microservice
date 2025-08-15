"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
class WebhookService {
    constructor(logger) {
        this.webhooks = new Map();
        this.stats = new Map();
        this.logger = console;
        if (logger) {
            this.logger = console;
        }
        this.startStatsCleanup();
    }
    startStatsCleanup() {
        setInterval(() => {
            const now = Date.now();
            const oneDayAgo = now - (24 * 60 * 60 * 1000);
            for (const [tenantId, stats] of this.stats.entries()) {
                if (stats.lastCall && stats.lastCall.getTime() < oneDayAgo) {
                    this.stats.delete(tenantId);
                }
            }
        }, 60 * 60 * 1000);
    }
    async registerWebhook(tenantId, config) {
        const webhookId = crypto_1.default.randomUUID();
        const webhook = {
            ...config,
            id: webhookId,
            successCount: 0,
            errorCount: 0,
            retryCount: 0
        };
        const tenantWebhooks = this.webhooks.get(tenantId) || [];
        tenantWebhooks.push(webhook);
        this.webhooks.set(tenantId, tenantWebhooks);
        this.logger.info?.('Webhook registered successfully', {
            tenantId,
            webhookId,
            url: config.url,
            events: config.events
        });
        return webhookId;
    }
    async getWebhooks(tenantId) {
        return this.webhooks.get(tenantId) || [];
    }
    async removeWebhook(tenantId, webhookId) {
        const tenantWebhooks = this.webhooks.get(tenantId) || [];
        const index = tenantWebhooks.findIndex(w => w.id === webhookId);
        if (index === -1) {
            return false;
        }
        tenantWebhooks.splice(index, 1);
        this.webhooks.set(tenantId, tenantWebhooks);
        this.logger.info?.('Webhook removed successfully', {
            tenantId,
            webhookId
        });
        return true;
    }
    async processIncomingMessage(message) {
        const webhooks = this.webhooks.get(message.tenantId) || [];
        const messageWebhooks = webhooks.filter(w => w.active && w.events.includes('message'));
        if (messageWebhooks.length === 0) {
            return;
        }
        const webhookPayload = {
            event: 'message',
            timestamp: message.timestamp,
            tenantId: message.tenantId,
            data: {
                from: message.from,
                to: message.to,
                message: message.message,
                messageId: message.messageId,
                type: message.type || 'text',
                mediaUrl: message.mediaUrl,
                caption: message.caption
            }
        };
        const promises = messageWebhooks.map(webhook => this.sendWebhook(webhook, webhookPayload, message.tenantId));
        await Promise.allSettled(promises);
    }
    async processStatusChange(statusChange) {
        const webhooks = this.webhooks.get(statusChange.tenantId) || [];
        const statusWebhooks = webhooks.filter(w => w.active && w.events.includes('status'));
        if (statusWebhooks.length === 0) {
            return;
        }
        const webhookPayload = {
            event: 'status_change',
            timestamp: statusChange.timestamp,
            tenantId: statusChange.tenantId,
            data: {
                status: statusChange.status,
                phoneNumber: statusChange.phoneNumber,
                event: statusChange.event
            }
        };
        const promises = statusWebhooks.map(webhook => this.sendWebhook(webhook, webhookPayload, statusChange.tenantId));
        await Promise.allSettled(promises);
    }
    async sendWebhook(webhook, payload, tenantId, retryCount = 0) {
        const startTime = Date.now();
        try {
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'WhatsApp-Microservice/1.0.0',
                'X-Webhook-Event': payload.event,
                'X-Tenant-ID': tenantId
            };
            if (webhook.secret) {
                const signature = this.generateSignature(JSON.stringify(payload), webhook.secret);
                headers['X-Webhook-Signature'] = signature;
            }
            const response = await axios_1.default.post(webhook.url, payload, {
                headers,
                timeout: 30000,
                maxRedirects: 3
            });
            this.updateWebhookStats(tenantId, true, Date.now() - startTime);
            if (webhook.successCount !== undefined) {
                webhook.successCount++;
            }
            webhook.lastUsed = new Date();
            this.logger.info?.('Webhook sent successfully', {
                tenantId,
                webhookId: webhook.id,
                url: webhook.url,
                status: response.status,
                responseTime: Date.now() - startTime
            });
        }
        catch (error) {
            this.updateWebhookStats(tenantId, false, Date.now() - startTime);
            if (webhook.errorCount !== undefined) {
                webhook.errorCount++;
            }
            this.logger.error?.('Webhook failed', {
                tenantId,
                webhookId: webhook.id,
                url: webhook.url,
                error: error.message,
                status: error.response?.status,
                retryCount
            });
            const maxRetries = 3;
            if (retryCount < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
                setTimeout(() => {
                    this.sendWebhook(webhook, payload, tenantId, retryCount + 1);
                }, delay);
                this.logger.info?.('Webhook retry scheduled', {
                    tenantId,
                    webhookId: webhook.id,
                    retryCount: retryCount + 1,
                    delay
                });
            }
            else {
                if (webhook.errorCount && webhook.errorCount > 10) {
                    webhook.active = false;
                    this.logger.warn?.('Webhook deactivated due to consecutive failures', {
                        tenantId,
                        webhookId: webhook.id,
                        errorCount: webhook.errorCount
                    });
                }
            }
        }
    }
    generateSignature(payload, secret) {
        return 'sha256=' + crypto_1.default
            .createHmac('sha256', secret)
            .update(payload, 'utf8')
            .digest('hex');
    }
    updateWebhookStats(tenantId, success, responseTime) {
        let stats = this.stats.get(tenantId) || {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            averageResponseTime: 0,
            uptime: 0
        };
        stats.totalCalls++;
        stats.lastCall = new Date();
        if (success) {
            stats.successfulCalls++;
        }
        else {
            stats.failedCalls++;
        }
        stats.averageResponseTime = ((stats.averageResponseTime * (stats.totalCalls - 1) + responseTime) / stats.totalCalls);
        stats.uptime = (stats.successfulCalls / stats.totalCalls) * 100;
        this.stats.set(tenantId, stats);
    }
    async testWebhook(tenantId, webhookId) {
        const webhooks = this.webhooks.get(tenantId) || [];
        const webhook = webhooks.find(w => w.id === webhookId);
        if (!webhook) {
            throw new Error('Webhook not found');
        }
        const testPayload = {
            event: 'test',
            timestamp: Date.now(),
            tenantId,
            data: {
                message: 'This is a test webhook from WhatsApp Microservice',
                test: true
            }
        };
        const startTime = Date.now();
        try {
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'WhatsApp-Microservice/1.0.0',
                'X-Webhook-Event': 'test',
                'X-Tenant-ID': tenantId
            };
            if (webhook.secret) {
                const signature = this.generateSignature(JSON.stringify(testPayload), webhook.secret);
                headers['X-Webhook-Signature'] = signature;
            }
            const response = await axios_1.default.post(webhook.url, testPayload, {
                headers,
                timeout: 10000
            });
            const responseTime = Date.now() - startTime;
            return {
                success: true,
                responseTime,
                status: response.status
            };
        }
        catch (error) {
            const responseTime = Date.now() - startTime;
            return {
                success: false,
                responseTime,
                status: error.response?.status,
                error: error.message
            };
        }
    }
    async getWebhookStats(tenantId, period) {
        const stats = this.stats.get(tenantId);
        if (!stats) {
            return {
                totalCalls: 0,
                successfulCalls: 0,
                failedCalls: 0,
                averageResponseTime: 0,
                uptime: 0
            };
        }
        return stats;
    }
    static validateSignature(payload, signature, secret) {
        const expectedSignature = 'sha256=' + crypto_1.default
            .createHmac('sha256', secret)
            .update(payload, 'utf8')
            .digest('hex');
        return crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    getAllStats() {
        return new Map(this.stats);
    }
    cleanupOldStats(olderThanHours = 24) {
        const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
        let cleanedCount = 0;
        for (const [tenantId, stats] of this.stats.entries()) {
            if (stats.lastCall && stats.lastCall.getTime() < cutoffTime) {
                this.stats.delete(tenantId);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            this.logger.info?.('Cleaned up old webhook stats', { cleanedCount });
        }
        return cleanedCount;
    }
}
exports.WebhookService = WebhookService;
