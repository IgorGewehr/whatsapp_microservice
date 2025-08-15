"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRoutes = webhookRoutes;
const express_1 = require("express");
const async_handler_1 = require("../utils/async-handler");
const webhook_service_1 = require("../services/webhook.service");
const validation_middleware_1 = require("../middleware/validation.middleware");
const joi_1 = __importDefault(require("joi"));
const incomingMessageSchema = joi_1.default.object({
    tenantId: joi_1.default.string().required(),
    from: joi_1.default.string().required(),
    to: joi_1.default.string().required(),
    message: joi_1.default.string().required(),
    messageId: joi_1.default.string().required(),
    timestamp: joi_1.default.number().required(),
    type: joi_1.default.string().valid('text', 'image', 'video', 'document', 'audio').default('text'),
    mediaUrl: joi_1.default.string().uri().optional(),
    caption: joi_1.default.string().optional()
});
function webhookRoutes(whatsappService, tenantManager) {
    const router = (0, express_1.Router)();
    const webhookService = new webhook_service_1.WebhookService();
    router.post('/internal/message', (0, validation_middleware_1.validateRequestBody)(incomingMessageSchema), (0, async_handler_1.handleAsync)(async (req, res) => {
        const messageData = req.body;
        try {
            await webhookService.processIncomingMessage(messageData);
            res.json({
                success: true,
                message: 'Message processed successfully',
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            req.log?.error('Failed to process incoming message:', error);
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to process message',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.post('/internal/status', (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId, status, phoneNumber, event } = req.body;
        try {
            await webhookService.processStatusChange({
                tenantId,
                status,
                phoneNumber,
                event,
                timestamp: Date.now()
            });
            res.json({
                success: true,
                message: 'Status change processed successfully',
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            req.log?.error('Failed to process status change:', error);
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to process status change',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.post('/register/:tenantId', (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        const { url, secret, events = ['message', 'status'] } = req.body;
        try {
            new URL(url);
            await webhookService.registerWebhook(tenantId, {
                url,
                secret,
                events,
                active: true
            });
            res.json({
                success: true,
                message: 'Webhook registered successfully',
                data: {
                    tenantId,
                    url,
                    events,
                    active: true
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(400).json({
                success: false,
                error: 'Failed to register webhook',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/list/:tenantId', (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        try {
            const webhooks = await webhookService.getWebhooks(tenantId);
            res.json({
                success: true,
                data: {
                    tenantId,
                    webhooks: webhooks.map(webhook => ({
                        ...webhook,
                        secret: webhook.secret ? '[HIDDEN]' : null
                    }))
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to get webhooks',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.delete('/:tenantId/:webhookId', (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId, webhookId } = req.params;
        try {
            await webhookService.removeWebhook(tenantId, webhookId);
            res.json({
                success: true,
                message: 'Webhook removed successfully',
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to remove webhook',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.post('/test/:tenantId/:webhookId', (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId, webhookId } = req.params;
        try {
            const testResult = await webhookService.testWebhook(tenantId, webhookId);
            res.json({
                success: testResult.success,
                data: testResult,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to test webhook',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/validate', (0, async_handler_1.handleAsync)(async (req, res) => {
        const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
        if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
            res.status(200).send(challenge);
        }
        else {
            res.status(403).json({
                success: false,
                error: 'Webhook validation failed',
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/stats/:tenantId', (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        const { period = '24h' } = req.query;
        try {
            const stats = await webhookService.getWebhookStats(tenantId, period);
            res.json({
                success: true,
                data: {
                    tenantId,
                    period,
                    stats
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to get webhook stats',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    return router;
}
