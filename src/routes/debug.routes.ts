import { Router } from 'express';
import { WhatsAppService } from '../services/whatsapp.service';
import { TenantManager } from '../services/tenant.service';
import { validateTenantAccess } from '../middleware/tenant.middleware';
import { handleAsync } from '../utils/async-handler';
import { config } from '../config/config';

export function debugRoutes(whatsappService: WhatsAppService, tenantManager: TenantManager): Router {
  const router = Router();

  // Debug: Status geral do sistema
  router.get('/status', 
    handleAsync(async (req, res) => {
      const activeSessions = whatsappService.getActiveSessions();
      
      res.json({
        success: true,
        data: {
          server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version,
            env: config.NODE_ENV
          },
          whatsapp: {
            activeSessions: activeSessions.length,
            sessions: activeSessions.map(session => ({
              tenantId: session.tenantId.substring(0, 8) + '***',
              status: session.status,
              connected: session.connected,
              lastActivity: session.lastActivity
            }))
          },
          transcription: {
            enabled: config.TRANSCRIPTION_ENABLED,
            provider: config.TRANSCRIPTION_PROVIDER,
            model: config.TRANSCRIPTION_MODEL,
            language: config.TRANSCRIPTION_LANGUAGE,
            hasApiKey: !!config.TRANSCRIPTION_API_KEY,
            apiKeyPreview: config.TRANSCRIPTION_API_KEY ? 
              config.TRANSCRIPTION_API_KEY.substring(0, 8) + '...' : null
          }
        },
        timestamp: new Date().toISOString()
      });
    })
  );

  // Debug: Testar transcrição com tenant específico
  router.post('/transcription/test/:tenantId',
    validateTenantAccess(tenantManager, ['sessions:write']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      if (!config.TRANSCRIPTION_ENABLED) {
        return res.status(400).json({
          success: false,
          error: 'Transcrição não está habilitada',
          config: {
            enabled: config.TRANSCRIPTION_ENABLED,
            provider: config.TRANSCRIPTION_PROVIDER
          }
        });
      }

      if (!config.TRANSCRIPTION_API_KEY) {
        return res.status(400).json({
          success: false,
          error: 'API Key da transcrição não configurada',
          hint: 'Configure TRANSCRIPTION_API_KEY no .env'
        });
      }

      // Verificar se sessão está ativa
      const session = whatsappService.getSession(tenantId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Sessão não encontrada',
          tenantId: tenantId.substring(0, 8) + '***'
        });
      }

      res.json({
        success: true,
        message: 'Configuração de transcrição OK. Envie um áudio pelo WhatsApp para testar.',
        data: {
          tenantId: tenantId.substring(0, 8) + '***',
          sessionStatus: session.status,
          sessionConnected: session.status === 'connected',
          transcription: {
            enabled: true,
            provider: config.TRANSCRIPTION_PROVIDER,
            model: config.TRANSCRIPTION_MODEL,
            language: config.TRANSCRIPTION_LANGUAGE
          }
        },
        timestamp: new Date().toISOString()
      });
    })
  );

  // Debug: Verificar configuração de webhook
  router.get('/webhook/test/:tenantId',
    validateTenantAccess(tenantManager, ['sessions:read']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      
      const webhookUrl = config.LOCAI_WEBHOOK_URL;
      const webhookSecret = config.LOCAI_WEBHOOK_SECRET;

      if (!webhookUrl) {
        return res.status(400).json({
          success: false,
          error: 'Webhook URL não configurada',
          hint: 'Configure LOCAI_WEBHOOK_URL no .env'
        });
      }

      // Simular evento de webhook
      const testEvent = {
        event: 'test',
        tenantId,
        data: {
          from: '5511999999999',
          text: 'Teste de webhook - transcrição de áudio',
          type: 'audio_transcribed',
          hasAudio: true,
          transcriptionCount: 1,
          timestamp: Math.floor(Date.now() / 1000)
        }
      };

      try {
        const fetch = await import('node-fetch');
        const response = await fetch.default(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Source': 'whatsapp-microservice',
            'X-Tenant-Id': tenantId,
            ...(webhookSecret && { 'X-Webhook-Secret': webhookSecret })
          },
          body: JSON.stringify(testEvent),
          timeout: 10000
        });

        const responseText = await response.text();

        res.json({
          success: true,
          message: 'Teste de webhook enviado',
          data: {
            webhookUrl: webhookUrl.substring(0, 50) + '...',
            hasSecret: !!webhookSecret,
            response: {
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              body: responseText.substring(0, 200)
            }
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Falha ao testar webhook',
          message: error instanceof Error ? error.message : 'Unknown error',
          data: {
            webhookUrl: webhookUrl.substring(0, 50) + '...',
            hasSecret: !!webhookSecret
          },
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Debug: Logs recentes (últimas 50 linhas)
  router.get('/logs', 
    handleAsync(async (req, res) => {
      try {
        // Capturar logs do console (limitado, pois logs vão para stdout)
        res.json({
          success: true,
          message: 'Para ver logs detalhados, use: pm2 logs whatsapp-microservice --lines 50',
          data: {
            hint: 'Logs são enviados para stdout. Use PM2, Docker logs ou journalctl para visualizar.',
            commands: [
              'pm2 logs whatsapp-microservice --lines 50',
              'pm2 logs whatsapp-microservice --follow',
              'journalctl -u whatsapp-microservice -f',
              'docker logs whatsapp-microservice --tail 50'
            ]
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Falha ao acessar logs',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    })
  );

  return router;
}