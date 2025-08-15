import { Router } from 'express';
import { WhatsAppService } from '../services/whatsapp.service';
import { TenantManager } from '../services/tenant.service';
import { validateTenantAccess } from '../middleware/tenant.middleware';
import { handleAsync } from '../utils/async-handler';
import { validateRequestBody } from '../middleware/validation.middleware';
import Joi from 'joi';

const startSessionSchema = Joi.object({
  // Opcionalmente aceitar configurações específicas para a sessão
  settings: Joi.object({
    webhookUrl: Joi.string().uri().optional(),
    autoReconnect: Joi.boolean().default(true),
    qrTimeout: Joi.number().min(30000).max(300000).optional()
  }).optional()
});

export function sessionRoutes(whatsappService: WhatsAppService, tenantManager: TenantManager): Router {
  const router = Router();

  // Iniciar sessão WhatsApp
  router.post('/:tenantId/start', 
    validateTenantAccess(tenantManager, ['sessions:write']),
    validateRequestBody(startSessionSchema),
    handleAsync(async (req, res) => {
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
        
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to start WhatsApp session',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Obter status da sessão
  router.get('/:tenantId/status', 
    validateTenantAccess(tenantManager, ['sessions:read']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      try {
        const status = await whatsappService.getSessionStatus(tenantId);
        
        res.json({
          success: true,
          data: status,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get session status',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Obter apenas QR code (endpoint específico para facilitar polling)
  router.get('/:tenantId/qr', 
    validateTenantAccess(tenantManager, ['sessions:read']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      try {
        const status = await whatsappService.getSessionStatus(tenantId);
        
        res.json({
          success: true,
          data: {
            qrCode: status.qrCode || null,
            status: status.status,
            hasQR: !!status.qrCode
          },
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get QR code',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Desconectar sessão
  router.delete('/:tenantId', 
    validateTenantAccess(tenantManager, ['sessions:write']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      try {
        const result = await whatsappService.disconnectSession(tenantId);
        
        res.json({
          success: result.success,
          message: result.message,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to disconnect session',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Reiniciar sessão (disconnect + start)
  router.post('/:tenantId/restart', 
    validateTenantAccess(tenantManager, ['sessions:write']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      try {
        // Primeiro desconectar
        await whatsappService.disconnectSession(tenantId);
        
        // Aguardar um pouco antes de reconectar
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Iniciar nova sessão
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
        
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to restart session',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Listar todas as sessões ativas (para admin)
  router.get('/active', 
    validateTenantAccess(tenantManager, ['sessions:admin']),
    handleAsync(async (req, res) => {
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
        
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get active sessions',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Endpoint para polling de status (otimizado)
  router.get('/:tenantId/poll', 
    validateTenantAccess(tenantManager, ['sessions:read']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      const { timeout = 30000 } = req.query; // Timeout de 30s por padrão
      
      try {
        const maxTimeout = Math.min(Number(timeout), 60000); // Máximo 60s
        const startTime = Date.now();
        
        // Polling loop para detectar mudanças de status
        while (Date.now() - startTime < maxTimeout) {
          const status = await whatsappService.getSessionStatus(tenantId);
          
          // Se tiver QR code ou estiver conectado, retornar imediatamente
          if (status.qrCode || status.connected) {
            return res.json({
              success: true,
              data: status,
              pollingTime: Date.now() - startTime,
              timestamp: new Date().toISOString()
            });
          }
          
          // Aguardar 2s antes da próxima verificação
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Timeout atingido, retornar status atual
        const finalStatus = await whatsappService.getSessionStatus(tenantId);
        res.json({
          success: true,
          data: finalStatus,
          pollingTime: Date.now() - startTime,
          timeout: true,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to poll session status',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  return router;
}