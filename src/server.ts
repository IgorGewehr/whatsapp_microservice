import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config/config';
import { WhatsAppService } from './services/whatsapp.service';
import { TenantManager } from './services/tenant.service';
import { authMiddleware } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { validateRequestBody } from './middleware/validation.middleware';
import { sessionRoutes } from './routes/session.routes';
import { messageRoutes } from './routes/message.routes';
import { webhookRoutes } from './routes/webhook.routes';
import { debugRoutes } from './routes/debug.routes';
import { StatusService } from './services/status.service';
import { WebhookService } from './services/webhook.service';

// Configurar logger
const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined
});

// Criar aplicação Express
const app = express();

// Middlewares de segurança
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: config.ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite de 100 requests por windowMs por IP
  message: 'Muitas requisições deste IP, tente novamente em 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Logging HTTP
app.use(pinoHttp({ logger: logger as any }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Inicializar serviços
const whatsappService = new WhatsAppService(logger);
const tenantManager = new TenantManager(logger);
const statusService = new StatusService(logger);

// Inicializar WebhookService para gerenciar webhooks automáticos
const webhookService = new WebhookService(logger);

// ✅ CONECTAR EVENTOS DO WHATSAPP AO WEBHOOK SERVICE
// Isso é CRUCIAL para que mensagens sejam enviadas para o LocAI
whatsappService.on('message', async (tenantId: string, messageData: any) => {
  try {
    // Processar mensagem recebida via webhook service
    await webhookService.processIncomingMessage({
      tenantId,
      from: messageData.from,
      to: messageData.to || '',
      message: messageData.text || '',
      messageId: messageData.id || '',
      timestamp: messageData.timestamp || Date.now(),
      type: messageData.type || 'text',
      messageReplied: messageData.messageReplied
    });
    
    (logger as any).info('✅ [Webhook] Mensagem processada e enviada para LocAI', {
      tenantId: tenantId.substring(0, 8) + '***',
      from: messageData.from?.substring(0, 6) + '***',
      messageId: messageData.id
    });
    
  } catch (error) {
    (logger as any).error('❌ [Webhook] Erro ao processar mensagem', {
      tenantId: tenantId.substring(0, 8) + '***',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// AUTO-REGISTRAR WEBHOOK DO LOCAI SE CONFIGURADO
if (config.LOCAI_WEBHOOK_URL) {
  // Registrar webhook automático para todos os tenants
  // Isso garante que as mensagens sejam enviadas para o LocAI
  const autoRegisterWebhook = async (tenantId: string) => {
    try {
      await webhookService.registerWebhook(tenantId, {
        url: config.LOCAI_WEBHOOK_URL!,
        secret: config.LOCAI_WEBHOOK_SECRET,
        events: ['message', 'status'],
        active: true
      });
      
      (logger as any).info('✅ [Webhook] Auto-registrado webhook LocAI', {
        tenantId: tenantId.substring(0, 8) + '***',
        url: config.LOCAI_WEBHOOK_URL
      });
    } catch (error) {
      // Ignorar erro se webhook já existe
      if (!(error instanceof Error && error.message.includes('already exists'))) {
        (logger as any).warn('⚠️ [Webhook] Erro ao auto-registrar webhook', {
          tenantId: tenantId.substring(0, 8) + '***',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  };

  // Auto-registrar webhook quando sessão for criada
  whatsappService.on('session_created', autoRegisterWebhook);
  
  (logger as any).info('🔗 [Webhook] Sistema de auto-registro configurado', {
    webhookUrl: config.LOCAI_WEBHOOK_URL
  });
}

// Health check
app.get('/health', async (req, res) => {
  try {
    const health = await statusService.getSystemHealth();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (error: unknown) {
    (logger as any).error(error, 'Health check failed');
    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Info sobre o serviço
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

// Middleware de autenticação (apenas para rotas protegidas)
app.use('/api/v1/sessions', authMiddleware);
app.use('/api/v1/messages', authMiddleware);
app.use('/api/v1/debug', authMiddleware);

// Rotas da API
app.use('/api/v1/sessions', sessionRoutes(whatsappService, tenantManager));
app.use('/api/v1/messages', messageRoutes(whatsappService, tenantManager));
app.use('/api/v1/webhooks', webhookRoutes(whatsappService, tenantManager));
app.use('/api/v1/debug', debugRoutes(whatsappService, tenantManager));

// Documentação da API
app.get('/docs', (req, res) => {
  res.json({
    title: 'WhatsApp Microservice API Documentation',
    version: '1.0.0',
    baseUrl: `${config.BASE_URL}/api/v1`,
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

// Error handling
app.use(errorHandler(logger));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint não encontrado',
    message: `${req.method} ${req.originalUrl} não existe`,
    availableEndpoints: ['/health', '/docs', '/api/v1/sessions', '/api/v1/messages']
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    // Desconectar todas as sessões WhatsApp
    await whatsappService.disconnectAllSessions();
    logger.info('All WhatsApp sessions disconnected');
    
    // Fechar servidor
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  } catch (error: unknown) {
    (logger as any).error(error, 'Error during graceful shutdown');
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    await whatsappService.disconnectAllSessions();
    process.exit(0);
  } catch (error: unknown) {
    (logger as any).error(error, 'Error during SIGINT shutdown');
    process.exit(1);
  }
});

// Iniciar servidor
const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(`🚀 WhatsApp Microservice running on ${config.HOST}:${config.PORT}`);
  logger.info(`📚 Documentation: ${config.BASE_URL}/docs`);
  logger.info(`💚 Health check: ${config.BASE_URL}/health`);
  logger.info(`🌍 Environment: ${config.NODE_ENV}`);
  logger.info(`🔑 Auth required: ${config.REQUIRE_AUTH ? 'Yes' : 'No'}`);
});

export { app, logger };