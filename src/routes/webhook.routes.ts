import { Router } from 'express';
import { WhatsAppService } from '../services/whatsapp.service';
import { TenantManager } from '../services/tenant.service';
import { handleAsync } from '../utils/async-handler';
import { WebhookService } from '../services/webhook.service';
import { validateRequestBody } from '../middleware/validation.middleware';
import Joi from 'joi';
import crypto from 'crypto';

// Schema para webhook de mensagem
const incomingMessageSchema = Joi.object({
  tenantId: Joi.string().required(),
  from: Joi.string().required(),
  to: Joi.string().required(),
  message: Joi.string().required(),
  messageId: Joi.string().required(),
  timestamp: Joi.number().required(),
  type: Joi.string().valid('text', 'image', 'video', 'document', 'audio').default('text'),
  mediaUrl: Joi.string().uri().optional(),
  caption: Joi.string().optional()
});

export function webhookRoutes(whatsappService: WhatsAppService, tenantManager: TenantManager): Router {
  const router = Router();
  const webhookService = new WebhookService();

  // Webhook para receber mensagens do WhatsApp (interno)
  // Este endpoint é chamado pelo próprio microserviço quando recebe mensagens
  router.post('/internal/message', 
    validateRequestBody(incomingMessageSchema),
    handleAsync(async (req, res) => {
      const messageData = req.body;
      
      try {
        // Processar mensagem recebida
        await webhookService.processIncomingMessage(messageData);
        
        res.json({
          success: true,
          message: 'Message processed successfully',
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        req.log?.error('Failed to process incoming message:', error);
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to process message',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Webhook para notificar mudanças de status das sessões
  router.post('/internal/status', 
    handleAsync(async (req, res) => {
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
        
      } catch (error: unknown) {
        req.log?.error('Failed to process status change:', error);
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to process status change',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Endpoint para registrar webhooks externos (LocAI)
  router.post('/register/:tenantId', 
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      const { url, secret, events = ['message', 'status'] } = req.body;
      
      try {
        // Validar URL
        new URL(url); // Throws if invalid
        
        // Registrar webhook para o tenant
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
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(400).json({
          success: false,
          error: 'Failed to register webhook',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Listar webhooks registrados
  router.get('/list/:tenantId', 
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      try {
        const webhooks = await webhookService.getWebhooks(tenantId);
        
        res.json({
          success: true,
          data: {
            tenantId,
            webhooks: webhooks.map(webhook => ({
              ...webhook,
              secret: webhook.secret ? '[HIDDEN]' : null // Não expor secrets
            }))
          },
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to get webhooks',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Remover webhook
  router.delete('/:tenantId/:webhookId', 
    handleAsync(async (req, res) => {
      const { tenantId, webhookId } = req.params;
      
      try {
        await webhookService.removeWebhook(tenantId, webhookId);
        
        res.json({
          success: true,
          message: 'Webhook removed successfully',
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to remove webhook',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Testar webhook
  router.post('/test/:tenantId/:webhookId', 
    handleAsync(async (req, res) => {
      const { tenantId, webhookId } = req.params;
      
      try {
        const testResult = await webhookService.testWebhook(tenantId, webhookId);
        
        res.json({
          success: testResult.success,
          data: testResult,
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to test webhook',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Endpoint público para validação de webhook (similar ao WhatsApp)
  router.get('/validate', 
    handleAsync(async (req, res) => {
      const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
      
      // Implementar validação similar ao Facebook/WhatsApp webhook
      if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        res.status(200).send(challenge);
      } else {
        res.status(403).json({
          success: false,
          error: 'Webhook validation failed',
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Estatísticas de webhooks
  router.get('/stats/:tenantId', 
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      try {
        const stats = await webhookService.getWebhookStats(tenantId);
        
        res.json({
          success: true,
          data: {
            tenantId,
            stats
          },
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to get webhook stats',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // 🔴 NOVO: Debug do cache de mensagens enviadas
  router.get('/debug/cache', 
    handleAsync(async (req, res) => {
      try {
        const cache = await webhookService.getSentMessagesCache();
        const summary = await webhookService.getWebhookSummary();
        
        res.json({
          success: true,
          data: {
            summary,
            recentMessages: cache.slice(0, 20), // Últimas 20 mensagens
            totalCacheSize: cache.length
          },
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to get debug info',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // 🔴 NOVO: Limpar cache manualmente (para debugging)
  router.post('/debug/clear-cache', 
    handleAsync(async (req, res) => {
      try {
        // Limpar cache de mensagens enviadas
        const clearedCount = (webhookService as any).sentMessages.size;
        (webhookService as any).sentMessages.clear();
        
        res.json({
          success: true,
          message: 'Cache cleared successfully',
          data: {
            clearedCount
          },
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to clear cache',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  return router;
}