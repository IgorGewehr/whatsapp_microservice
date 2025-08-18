"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const pino_1 = __importDefault(require("pino"));
const pino_http_1 = __importDefault(require("pino-http"));
const config_1 = require("./config/config");
const whatsapp_service_1 = require("./services/whatsapp.service");
const tenant_service_1 = require("./services/tenant.service");
const auth_middleware_1 = require("./middleware/auth.middleware");
const error_middleware_1 = require("./middleware/error.middleware");
const session_routes_1 = require("./routes/session.routes");
const message_routes_1 = require("./routes/message.routes");
const webhook_routes_1 = require("./routes/webhook.routes");
const status_service_1 = require("./services/status.service");
const webhook_service_1 = require("./services/webhook.service");
const logger = (0, pino_1.default)({
    level: config_1.config.LOG_LEVEL,
    transport: config_1.config.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: { colorize: true }
    } : undefined
});
exports.logger = logger;
const app = (0, express_1.default)();
exports.app = app;
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));
app.use((0, cors_1.default)({
    origin: config_1.config.ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID']
}));
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Muitas requisições deste IP, tente novamente em 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
app.use((0, pino_http_1.default)({ logger: logger }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
const whatsappService = new whatsapp_service_1.WhatsAppService(logger);
const tenantManager = new tenant_service_1.TenantManager(logger);
const statusService = new status_service_1.StatusService(logger);
const webhookService = new webhook_service_1.WebhookService(logger);
whatsappService.on('message', async (tenantId, messageData) => {
    try {
        await webhookService.processIncomingMessage({
            tenantId,
            from: messageData.from,
            to: messageData.to || '',
            message: messageData.text || '',
            messageId: messageData.id || '',
            timestamp: messageData.timestamp || Date.now(),
            type: messageData.type || 'text'
        });
        logger.info('✅ [Webhook] Mensagem processada e enviada para LocAI', {
            tenantId: tenantId.substring(0, 8) + '***',
            from: messageData.from?.substring(0, 6) + '***',
            messageId: messageData.id
        });
    }
    catch (error) {
        logger.error('❌ [Webhook] Erro ao processar mensagem', {
            tenantId: tenantId.substring(0, 8) + '***',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
if (config_1.config.LOCAI_WEBHOOK_URL) {
    const autoRegisterWebhook = async (tenantId) => {
        try {
            await webhookService.registerWebhook(tenantId, {
                url: config_1.config.LOCAI_WEBHOOK_URL,
                secret: config_1.config.LOCAI_WEBHOOK_SECRET,
                events: ['message', 'status'],
                active: true
            });
            logger.info('✅ [Webhook] Auto-registrado webhook LocAI', {
                tenantId: tenantId.substring(0, 8) + '***',
                url: config_1.config.LOCAI_WEBHOOK_URL
            });
        }
        catch (error) {
            if (!(error instanceof Error && error.message.includes('already exists'))) {
                logger.warn('⚠️ [Webhook] Erro ao auto-registrar webhook', {
                    tenantId: tenantId.substring(0, 8) + '***',
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    };
    whatsappService.on('session_created', autoRegisterWebhook);
    logger.info('🔗 [Webhook] Sistema de auto-registro configurado', {
        webhookUrl: config_1.config.LOCAI_WEBHOOK_URL
    });
}
app.get('/health', async (req, res) => {
    try {
        const health = await statusService.getSystemHealth();
        res.status(health.status === 'healthy' ? 200 : 503).json(health);
    }
    catch (error) {
        logger.error(error, 'Health check failed');
        res.status(503).json({
            status: 'error',
            message: 'Health check failed',
            timestamp: new Date().toISOString()
        });
    }
});
app.get('/', (req, res) => {
    res.json({
        service: 'WhatsApp Microservice',
        version: '1.0.0',
        description: 'Microserviço WhatsApp com Baileys para DigitalOcean',
        endpoints: {
            health: '/health',
            sessions: '/api/v1/sessions',
            messages: '/api/v1/messages',
            webhooks: '/api/v1/webhooks'
        },
        documentation: '/docs',
        timestamp: new Date().toISOString()
    });
});
app.use('/api/v1/sessions', auth_middleware_1.authMiddleware);
app.use('/api/v1/messages', auth_middleware_1.authMiddleware);
app.use('/api/v1/sessions', (0, session_routes_1.sessionRoutes)(whatsappService, tenantManager));
app.use('/api/v1/messages', (0, message_routes_1.messageRoutes)(whatsappService, tenantManager));
app.use('/api/v1/webhooks', (0, webhook_routes_1.webhookRoutes)(whatsappService, tenantManager));
app.get('/docs', (req, res) => {
    res.json({
        title: 'WhatsApp Microservice API Documentation',
        version: '1.0.0',
        baseUrl: `${config_1.config.BASE_URL}/api/v1`,
        authentication: 'Bearer token required for most endpoints',
        endpoints: {
            sessions: {
                'POST /sessions/{tenantId}/start': {
                    description: 'Iniciar sessão WhatsApp e gerar QR code',
                    parameters: { tenantId: 'string (path)' },
                    response: { qrCode: 'string', status: 'string', sessionId: 'string' }
                },
                'GET /sessions/{tenantId}/status': {
                    description: 'Obter status da sessão e QR code atual',
                    parameters: { tenantId: 'string (path)' },
                    response: { connected: 'boolean', status: 'string', qrCode: 'string', phone: 'string' }
                },
                'DELETE /sessions/{tenantId}': {
                    description: 'Desconectar sessão WhatsApp',
                    parameters: { tenantId: 'string (path)' },
                    response: { success: 'boolean', message: 'string' }
                }
            },
            messages: {
                'POST /messages/{tenantId}/send': {
                    description: 'Enviar mensagem via WhatsApp',
                    parameters: { tenantId: 'string (path)', to: 'string', message: 'string', type: 'text|image|video' },
                    response: { success: 'boolean', messageId: 'string' }
                }
            },
            webhooks: {
                'POST /webhooks/message': {
                    description: 'Webhook para mensagens recebidas (notifica LocAI)',
                    authentication: 'Internal use only',
                    response: { success: 'boolean' }
                }
            }
        }
    });
});
app.use((0, error_middleware_1.errorHandler)(logger));
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint não encontrado',
        message: `${req.method} ${req.originalUrl} não existe`,
        availableEndpoints: ['/health', '/docs', '/api/v1/sessions', '/api/v1/messages']
    });
});
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    try {
        await whatsappService.disconnectAllSessions();
        logger.info('All WhatsApp sessions disconnected');
        server.close(() => {
            logger.info('HTTP server closed');
            process.exit(0);
        });
    }
    catch (error) {
        logger.error(error, 'Error during graceful shutdown');
        process.exit(1);
    }
});
process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    try {
        await whatsappService.disconnectAllSessions();
        process.exit(0);
    }
    catch (error) {
        logger.error(error, 'Error during SIGINT shutdown');
        process.exit(1);
    }
});
const server = app.listen(config_1.config.PORT, config_1.config.HOST, () => {
    logger.info(`🚀 WhatsApp Microservice running on ${config_1.config.HOST}:${config_1.config.PORT}`);
    logger.info(`📚 Documentation: ${config_1.config.BASE_URL}/docs`);
    logger.info(`💚 Health check: ${config_1.config.BASE_URL}/health`);
    logger.info(`🌍 Environment: ${config_1.config.NODE_ENV}`);
    logger.info(`🔑 Auth required: ${config_1.config.REQUIRE_AUTH ? 'Yes' : 'No'}`);
});
