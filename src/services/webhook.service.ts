import { Logger } from 'pino';
import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';

export interface WebhookConfig {
  id?: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
  retryCount?: number;
  lastUsed?: Date;
  successCount?: number;
  errorCount?: number;
}

export interface IncomingMessage {
  tenantId: string;
  from: string;
  to?: string;
  message: string;
  messageId: string;
  timestamp: number;
  type?: string;
  mediaUrl?: string;
  caption?: string;
}

export interface StatusChange {
  tenantId: string;
  status: string;
  phoneNumber?: string;
  event: 'connected' | 'disconnected' | 'qr' | 'connecting';
  timestamp: number;
}

export interface WebhookStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageResponseTime: number;
  lastCall?: Date;
  uptime: number;
}

export class WebhookService {
  private webhooks: Map<string, WebhookConfig[]> = new Map();
  private stats: Map<string, WebhookStats> = new Map();
  private logger = console; // Será injetado pelo construtor

  constructor(logger?: Logger) {
    if (logger) {
      this.logger = console; // Simplified for compilation
    }
    this.startStatsCleanup();
  }

  private startStatsCleanup(): void {
    // Limpar estatísticas antigas a cada hora
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

  async registerWebhook(tenantId: string, config: Omit<WebhookConfig, 'id'>): Promise<string> {
    const webhookId = crypto.randomUUID();
    const webhook: WebhookConfig = {
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

  async getWebhooks(tenantId: string): Promise<WebhookConfig[]> {
    return this.webhooks.get(tenantId) || [];
  }

  async removeWebhook(tenantId: string, webhookId: string): Promise<boolean> {
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

  async processIncomingMessage(message: IncomingMessage): Promise<void> {
    const webhooks = this.webhooks.get(message.tenantId) || [];
    const messageWebhooks = webhooks.filter(w => 
      w.active && w.events.includes('message')
    );

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

    // Enviar para todos os webhooks em paralelo
    const promises = messageWebhooks.map(webhook => 
      this.sendWebhook(webhook, webhookPayload, message.tenantId)
    );

    await Promise.allSettled(promises);
  }

  async processStatusChange(statusChange: StatusChange): Promise<void> {
    const webhooks = this.webhooks.get(statusChange.tenantId) || [];
    const statusWebhooks = webhooks.filter(w => 
      w.active && w.events.includes('status')
    );

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

    const promises = statusWebhooks.map(webhook => 
      this.sendWebhook(webhook, webhookPayload, statusChange.tenantId)
    );

    await Promise.allSettled(promises);
  }

  private async sendWebhook(
    webhook: WebhookConfig, 
    payload: any, 
    tenantId: string,
    retryCount: number = 0
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Microservice/1.0.0',
        'X-Webhook-Event': payload.event,
        'X-Tenant-ID': tenantId
      };

      // Adicionar assinatura HMAC se secret estiver configurado
      if (webhook.secret) {
        const signature = this.generateSignature(JSON.stringify(payload), webhook.secret);
        headers['X-Webhook-Signature'] = signature;
      }

      const response: AxiosResponse = await axios.post(webhook.url, payload, {
        headers,
        timeout: 30000, // 30 segundos
        maxRedirects: 3
      });

      // Atualizar estatísticas de sucesso
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

    } catch (error: any) {
      // Atualizar estatísticas de erro
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

      // Implementar retry com backoff exponencial
      const maxRetries = 3;
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30s
        
        setTimeout(() => {
          this.sendWebhook(webhook, payload, tenantId, retryCount + 1);
        }, delay);
        
        this.logger.info?.('Webhook retry scheduled', {
          tenantId,
          webhookId: webhook.id,
          retryCount: retryCount + 1,
          delay
        });
      } else {
        // Desativar webhook após muitas falhas consecutivas
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

  private generateSignature(payload: string, secret: string): string {
    return 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  private updateWebhookStats(tenantId: string, success: boolean, responseTime: number): void {
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
    } else {
      stats.failedCalls++;
    }

    // Calcular tempo médio de resposta
    stats.averageResponseTime = (
      (stats.averageResponseTime * (stats.totalCalls - 1) + responseTime) / stats.totalCalls
    );

    // Calcular uptime (porcentagem de sucesso)
    stats.uptime = (stats.successfulCalls / stats.totalCalls) * 100;

    this.stats.set(tenantId, stats);
  }

  async testWebhook(tenantId: string, webhookId: string): Promise<{
    success: boolean;
    responseTime: number;
    status?: number;
    error?: string;
  }> {
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Microservice/1.0.0',
        'X-Webhook-Event': 'test',
        'X-Tenant-ID': tenantId
      };

      if (webhook.secret) {
        const signature = this.generateSignature(JSON.stringify(testPayload), webhook.secret);
        headers['X-Webhook-Signature'] = signature;
      }

      const response = await axios.post(webhook.url, testPayload, {
        headers,
        timeout: 10000 // 10 segundos para teste
      });

      const responseTime = Date.now() - startTime;

      return {
        success: true,
        responseTime,
        status: response.status
      };

    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      return {
        success: false,
        responseTime,
        status: error.response?.status,
        error: error.message
      };
    }
  }

  async getWebhookStats(tenantId: string, period: string): Promise<WebhookStats> {
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

    // TODO: Implementar filtros por período quando integrar com banco de dados
    return stats;
  }

  // Método para validar assinatura do webhook (usado pelos clientes)
  static validateSignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  // Método para obter todas as estatísticas
  getAllStats(): Map<string, WebhookStats> {
    return new Map(this.stats);
  }

  // Método para limpar estatísticas antigas
  cleanupOldStats(olderThanHours: number = 24): number {
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