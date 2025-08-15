"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageRoutes = messageRoutes;
const express_1 = require("express");
const tenant_middleware_1 = require("../middleware/tenant.middleware");
const async_handler_1 = require("../utils/async-handler");
const validation_middleware_1 = require("../middleware/validation.middleware");
const joi_1 = __importDefault(require("joi"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config/config");
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config_1.config.UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: config_1.config.MAX_FILE_SIZE,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/webp',
            'video/mp4',
            'video/avi',
            'video/mov',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error(`File type ${file.mimetype} not allowed`));
        }
    }
});
const sendMessageSchema = joi_1.default.object({
    to: joi_1.default.string().required().pattern(/^\+?[1-9]\d{10,14}$/).messages({
        'string.pattern.base': 'Phone number must be in international format (+5511999999999)'
    }),
    message: joi_1.default.string().required().max(4096).messages({
        'string.max': 'Message cannot exceed 4096 characters'
    }),
    type: joi_1.default.string().valid('text', 'image', 'video', 'document').default('text'),
    caption: joi_1.default.string().max(1024).optional(),
    fileName: joi_1.default.string().max(255).optional()
});
const sendBulkMessageSchema = joi_1.default.object({
    messages: joi_1.default.array().items(joi_1.default.object({
        to: joi_1.default.string().required().pattern(/^\+?[1-9]\d{10,14}$/),
        message: joi_1.default.string().required().max(4096),
        type: joi_1.default.string().valid('text', 'image', 'video', 'document').default('text'),
        caption: joi_1.default.string().max(1024).optional(),
        delay: joi_1.default.number().min(1000).max(60000).optional()
    })).min(1).max(50).required().messages({
        'array.max': 'Cannot send more than 50 messages at once'
    })
});
function messageRoutes(whatsappService, tenantManager) {
    const router = (0, express_1.Router)();
    router.post('/:tenantId/send', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['messages:send']), (0, validation_middleware_1.validateRequestBody)(sendMessageSchema), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        const messageData = req.body;
        try {
            const result = await whatsappService.sendMessage(tenantId, messageData);
            if (result.success) {
                res.json({
                    success: true,
                    data: {
                        messageId: result.messageId,
                        to: messageData.to,
                        type: messageData.type || 'text'
                    },
                    timestamp: new Date().toISOString()
                });
            }
            else {
                res.status(400).json({
                    success: false,
                    error: result.error,
                    message: 'Failed to send message',
                    timestamp: new Date().toISOString()
                });
            }
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.post('/:tenantId/send-media', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['messages:send']), upload.single('media'), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        const { to, message, caption, type } = req.body;
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No media file provided',
                    timestamp: new Date().toISOString()
                });
            }
            if (!to || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone number and message are required',
                    timestamp: new Date().toISOString()
                });
            }
            let mediaType = type;
            if (!mediaType) {
                const mimeType = req.file.mimetype;
                if (mimeType.startsWith('image/')) {
                    mediaType = 'image';
                }
                else if (mimeType.startsWith('video/')) {
                    mediaType = 'video';
                }
                else {
                    mediaType = 'document';
                }
            }
            const messageData = {
                to: to.replace(/\D/g, ''),
                message,
                type: mediaType,
                mediaUrl: `${config_1.config.BASE_URL}/uploads/${req.file.filename}`,
                caption: caption || message,
                fileName: req.file.originalname
            };
            const result = await whatsappService.sendMessage(tenantId, messageData);
            if (result.success) {
                res.json({
                    success: true,
                    data: {
                        messageId: result.messageId,
                        to: messageData.to,
                        type: messageData.type,
                        mediaUrl: messageData.mediaUrl,
                        fileName: req.file.originalname,
                        fileSize: req.file.size
                    },
                    timestamp: new Date().toISOString()
                });
            }
            else {
                res.status(400).json({
                    success: false,
                    error: result.error,
                    message: 'Failed to send media message',
                    timestamp: new Date().toISOString()
                });
            }
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.post('/:tenantId/send-bulk', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['messages:send', 'messages:bulk']), (0, validation_middleware_1.validateRequestBody)(sendBulkMessageSchema), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        const { messages } = req.body;
        try {
            const results = [];
            for (let i = 0; i < messages.length; i++) {
                const messageData = messages[i];
                try {
                    const result = await whatsappService.sendMessage(tenantId, messageData);
                    results.push({
                        index: i,
                        to: messageData.to,
                        success: result.success,
                        messageId: result.messageId,
                        error: result.error
                    });
                    if (i < messages.length - 1 && messageData.delay) {
                        await new Promise(resolve => setTimeout(resolve, messageData.delay));
                    }
                    else if (i < messages.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
                catch (error) {
                    const err = error;
                    results.push({
                        index: i,
                        to: messageData.to,
                        success: false,
                        error: err.message
                    });
                }
            }
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;
            res.json({
                success: true,
                data: {
                    results,
                    summary: {
                        total: messages.length,
                        successful: successCount,
                        failed: failCount,
                        successRate: (successCount / messages.length) * 100
                    }
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Bulk message sending failed',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/:tenantId/check-number/:phoneNumber', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['messages:read']), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId, phoneNumber } = req.params;
        try {
            const status = await whatsappService.getSessionStatus(tenantId);
            if (!status.connected) {
                return res.status(400).json({
                    success: false,
                    error: 'WhatsApp session not connected',
                    message: 'Session must be connected to check phone numbers',
                    timestamp: new Date().toISOString()
                });
            }
            const formattedNumber = phoneNumber.replace(/\D/g, '');
            res.json({
                success: true,
                data: {
                    phoneNumber: formattedNumber,
                    isOnWhatsApp: true,
                    businessAccount: false
                },
                message: 'Note: This is a simplified implementation',
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to check phone number',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    router.get('/:tenantId/history', (0, tenant_middleware_1.validateTenantAccess)(tenantManager, ['messages:read']), (0, async_handler_1.handleAsync)(async (req, res) => {
        const { tenantId } = req.params;
        const { page = 1, limit = 50, phoneNumber } = req.query;
        try {
            res.json({
                success: true,
                data: {
                    messages: [],
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        total: 0,
                        pages: 0
                    }
                },
                message: 'Message history feature not implemented yet',
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                success: false,
                error: 'Failed to get message history',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
    }));
    return router;
}
