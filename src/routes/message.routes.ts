import { Router } from 'express';
import { WhatsAppService, MessageData } from '../services/whatsapp.service';
import { TenantManager } from '../services/tenant.service';
import { validateTenantAccess } from '../middleware/tenant.middleware';
import { handleAsync } from '../utils/async-handler';
import { validateRequestBody } from '../middleware/validation.middleware';
import Joi from 'joi';
import multer from 'multer';
import path from 'path';
import { config } from '../config/config';

// Configurar multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Tipos de arquivo permitidos
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
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

// Schema para validação de mensagens
const sendMessageSchema = Joi.object({
  to: Joi.string().required().pattern(/^\+?[1-9]\d{10,14}$/).messages({
    'string.pattern.base': 'Phone number must be in international format (+5511999999999)'
  }),
  message: Joi.string().required().max(4096).messages({
    'string.max': 'Message cannot exceed 4096 characters'
  }),
  type: Joi.string().valid('text', 'image', 'video', 'document', 'media').default('text'),
  mediaUrls: Joi.array().items(Joi.string().uri()).optional(),
  mediaType: Joi.string().valid('image', 'video', 'document').optional(),
  caption: Joi.string().max(1024).optional(),
  fileName: Joi.string().max(255).optional()
});

const sendBulkMessageSchema = Joi.object({
  messages: Joi.array().items(Joi.object({
    to: Joi.string().required().pattern(/^\+?[1-9]\d{10,14}$/),
    message: Joi.string().required().max(4096),
    type: Joi.string().valid('text', 'image', 'video', 'document', 'media').default('text'),
    mediaUrls: Joi.array().items(Joi.string().uri()).optional(),
    mediaType: Joi.string().valid('image', 'video', 'document').optional(),
    caption: Joi.string().max(1024).optional(),
    delay: Joi.number().min(1000).max(60000).optional() // Delay entre mensagens (1s-60s)
  })).min(1).max(50).required().messages({
    'array.max': 'Cannot send more than 50 messages at once'
  })
});

export function messageRoutes(whatsappService: WhatsAppService, tenantManager: TenantManager): Router {
  const router = Router();

  // Enviar mensagem de texto
  router.post('/:tenantId/send', 
    validateTenantAccess(tenantManager, ['messages:send']),
    validateRequestBody(sendMessageSchema),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      const messageData: MessageData = req.body;
      
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
        } else {
          res.status(400).json({
            success: false,
            error: result.error,
            message: 'Failed to send message',
            timestamp: new Date().toISOString()
          });
        }
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Enviar mensagem com arquivo (mídia)
  router.post('/:tenantId/send-media', 
    validateTenantAccess(tenantManager, ['messages:send']),
    upload.single('media'),
    handleAsync(async (req, res) => {
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

        // Determinar tipo baseado no arquivo se não especificado
        let mediaType = type;
        if (!mediaType) {
          const mimeType = req.file.mimetype;
          if (mimeType.startsWith('image/')) {
            mediaType = 'image';
          } else if (mimeType.startsWith('video/')) {
            mediaType = 'video';
          } else {
            mediaType = 'document';
          }
        }

        const messageData: MessageData = {
          to: to.replace(/\D/g, ''), // Remover caracteres não numéricos
          message,
          type: mediaType as 'image' | 'video' | 'document',
          mediaUrl: `${config.BASE_URL}/uploads/${req.file.filename}`,
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
        } else {
          res.status(400).json({
            success: false,
            error: result.error,
            message: 'Failed to send media message',
            timestamp: new Date().toISOString()
          });
        }
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Enviar múltiplas mensagens (bulk)
  router.post('/:tenantId/send-bulk', 
    validateTenantAccess(tenantManager, ['messages:send', 'messages:bulk']),
    validateRequestBody(sendBulkMessageSchema),
    handleAsync(async (req, res) => {
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
            
            // Aplicar delay entre mensagens se especificado
            if (i < messages.length - 1 && messageData.delay) {
              await new Promise(resolve => setTimeout(resolve, messageData.delay));
            } else if (i < messages.length - 1) {
              // Delay padrão de 2s entre mensagens para evitar spam
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
          } catch (error: unknown) {
            const err = error as Error;
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
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Bulk message sending failed',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Verificar se um número está no WhatsApp
  router.get('/:tenantId/check-number/:phoneNumber', 
    validateTenantAccess(tenantManager, ['messages:read']),
    handleAsync(async (req, res) => {
      const { tenantId, phoneNumber } = req.params;
      
      try {
        // Esta funcionalidade requer que a sessão esteja conectada
        const status = await whatsappService.getSessionStatus(tenantId);
        
        if (!status.connected) {
          return res.status(400).json({
            success: false,
            error: 'WhatsApp session not connected',
            message: 'Session must be connected to check phone numbers',
            timestamp: new Date().toISOString()
          });
        }

        // Formatar número
        const formattedNumber = phoneNumber.replace(/\D/g, '');
        
        // Tentar enviar uma mensagem de teste (que não será realmente enviada)
        // Isso é uma implementação simplificada - na prática, você pode usar
        // a funcionalidade onWhatsApp do Baileys se estiver disponível
        
        res.json({
          success: true,
          data: {
            phoneNumber: formattedNumber,
            isOnWhatsApp: true, // Simplificado - implementar lógica real
            businessAccount: false // Simplificado - implementar lógica real
          },
          message: 'Note: This is a simplified implementation',
          timestamp: new Date().toISOString()
        });
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to check phone number',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  // Histórico de mensagens enviadas (simplificado)
  router.get('/:tenantId/history', 
    validateTenantAccess(tenantManager, ['messages:read']),
    handleAsync(async (req, res) => {
      const { tenantId } = req.params;
      const { page = 1, limit = 50, phoneNumber } = req.query;
      
      try {
        // Esta é uma implementação mock - em produção você salvaria
        // as mensagens em banco de dados
        
        res.json({
          success: true,
          data: {
            messages: [], // Implementar busca no banco de dados
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
        
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({
          success: false,
          error: 'Failed to get message history',
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    })
  );

  return router;
}