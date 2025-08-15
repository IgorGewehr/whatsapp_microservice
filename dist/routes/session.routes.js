"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionRoutes = sessionRoutes;
const express_1 = require("express");
const tenant_middleware_1 = require("../middleware/tenant.middleware");
const async_handler_1 = require("../utils/async-handler");
const validation_middleware_1 = require("../middleware/validation.middleware");
const joi_1 = __importDefault(require("joi"));
const startSessionSchema = joi_1.default.object({
    settings: joi_1.default.object({
        webhookUrl: joi_1.default.string().uri().optional(),
        autoReconnect: joi_1.default.boolean().default(true),
        qrTimeout: joi_1.default.number().min(30000).max(300000).optional()
    }).optional()
});
function sessionRoutes(whatsappService, tenantManager) {
    const router = (0, express_1.Router)();
    router.post('/:tenantId/start', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['sessions:write']), (0, validation_middleware_1.validateRequestBody)(startSessionSchema), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        try {
            const result = await whatsappService.startSession(tenantId);
            res.json({
                success: true,
                data: {
                    sessionId: result.sessionId,
                    message: result.message,
                    qrCode: result.qrCode || null
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to start WhatsApp session',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/:tenantId/status', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['sessions:read']), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        try {
            const status = await whatsappService.getSessionStatus(tenantId);
            res.json({
                success: true,
                data: status,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to get session status',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/:tenantId/qr', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['sessions:read']), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        try {
            const status = await whatsappService.getSessionStatus(tenantId);
            const qrData = {
                qrCode: status.qrCode || null,
                status: status.status,
                hasQR: !!status.qrCode,
                lastActivity: status.lastActivity,
                persistent: true,
                cacheOptimized: true
            };
            res.json({
                success: true,
                data: qrData,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to get QR code',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.delete('/:tenantId', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['sessions:write']), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        try {
            const result = await whatsappService.disconnectSession(tenantId);
            res.json({
                success: result.success,
                message: result.message,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to disconnect session',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.post('/:tenantId/restart', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['sessions:write']), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        try {
            await whatsappService.disconnectSession(tenantId);
            await new Promise(resolve => setTimeout(resolve, 2000));
            const result = await whatsappService.startSession(tenantId);
            res.json({
                success: true,
                data: {
                    sessionId: result.sessionId,
                    message: 'Session restarted successfully',
                    qrCode: result.qrCode || null
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to restart session',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/active', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['sessions:admin']), (0, async_handler_1.handleAsync)(async (req, res) => {
        try {
            const sessions = whatsappService.getActiveSessions();
            res.json({
                success: true,
                data: {
                    sessions,
                    count: sessions.length
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to get active sessions',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/:tenantId/poll', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['sessions:read']), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        const { timeout = 30000 } = req.query;
        try {
            const maxTimeout = Math.min(Number(timeout), 60000);
            const startTime = Date.now();
            while (Date.now() - startTime < maxTimeout) {
                const status = await whatsappService.getSessionStatus(tenantId);
                if (status.qrCode || status.connected) {
                    return res.json({
                        success: true,
                        data: status,
                        pollingTime: Date.now() - startTime,
                        timestamp: new Date().toISOString()
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            const finalStatus = await whatsappService.getSessionStatus(tenantId);
            res.json({
                success: true,
                data: finalStatus,
                pollingTime: Date.now() - startTime,
                timeout: true,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to poll session status',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    return router;
}
