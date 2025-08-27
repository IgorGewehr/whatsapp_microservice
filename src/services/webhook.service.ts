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
  messageReplied?: string;
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
  private webhooks: Map<string, WebhookConfig> = new Map(); // 🔴 MUDANÇA: Um webhook por tenant
  private stats: Map<string, WebhookStats> = new Map();
  private sentMessages: Map<string, number> = new Map(); // 🔴 NOVO: Cache de mensagens enviadas
  private logger = console; // Será injetado pelo construtor

  constructor(logger?: Logger) {
    if (logger) {
      this.logger = console; // Simplified for compilation
    }
    this.startStatsCleanup();
    this.startMessageCacheCleanup(); // 🔴 NOVO: Limpeza do cache de mensagens
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

  // 🔴 NOVO: Limpeza do cache de mensagens enviadas
  private startMessageCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const tenMinutesAgo = now - (10 * 60 * 1000); // 10 minutos
      
      let cleanedCount = 0;
      for (const [messageKey, timestamp] of this.sentMessages.entries()) {
        if (timestamp < tenMinutesAgo) {
          this.sentMessages.delete(messageKey);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        this.logger.info?.('Cleaned up sent messages cache', {
          cleanedCount,
          remainingCount: this.sentMessages.size
        });
      }
    }, 2 * 60 * 1000); // Verificar a cada 2 minutos
  }

  // 🔴 NOVO: Verificar se mensagem já foi enviada
  private isMessageAlreadySent(tenantId: string, messageId: string): boolean {
    const messageKey = `${tenantId}_${messageId}`;
    return this.sentMessages.has(messageKey);
  }

  // 🔴 NOVO: Marcar mensagem como enviada
  private markMessageAsSent(tenantId: string, messageId: string): void {
    const messageKey = `${tenantId}_${messageId}`;
    this.sentMessages.set(messageKey, Date.now());
  }

  // 🔴 MODIFICADO: Registrar apenas um webhook por tenant
  async registerWebhook(tenantId: string, config: Omit<WebhookConfig, 'id'>): Promise<string> {
    // Verificar se já existe webhook para este tenant
    const existingWebhook = this.webhooks.get(tenantId);
    if (existingWebhook) {
      // Atualizar webhook existente ao invés de criar novo
      const updatedWebhook: WebhookConfig = {
        ...existingWebhook,
        ...config,
        successCount: existingWebhook.successCount || 0,
        errorCount: existingWebhook.errorCount || 0
      };
      
      this.webhooks.set(tenantId, updatedWebhook);
      
      this.logger.info?.('Webhook updated (only one per tenant allowed)', {
        tenantId,
        webhookId: existingWebhook.id,
        oldUrl: existingWebhook.url,
        newUrl: config.url,
        events: config.events
      });
      
      return existingWebhook.id!;
    }

    // Criar novo webhook
    const webhookId = crypto.randomUUID();
    const webhook: WebhookConfig = {
      ...config,
      id: webhookId,
      successCount: 0,
      errorCount: 0,
      retryCount: 0
    };

    this.webhooks.set(tenantId, webhook);

    this.logger.info?.('Webhook registered successfully', {
      tenantId,
      webhookId,
      url: config.url,
      events: config.events
    });

    return webhookId;
  }

  // 🔴 MODIFICADO: Retornar o webhook único do tenant
  async getWebhooks(tenantId: string): Promise<WebhookConfig[]> {
    const webhook = this.webhooks.get(tenantId);
    return webhook ? [webhook] : [];
  }

  // 🔴 MODIFICADO: Remover webhook do tenant
  async removeWebhook(tenantId: string, webhookId?: string): Promise<boolean> {
    const webhook = this.webhooks.get(tenantId);
    
    if (!webhook || (webhookId && webhook.id !== webhookId)) {
      return false;
    }

    this.webhooks.delete(tenantId);

    this.logger.info?.('Webhook removed successfully', {
      tenantId,
      webhookId: webhook.id
    });

    return true;
  }

  // 🔴 MODIFICADO: Verificar duplicatas antes de processar
  async processIncomingMessage(message: IncomingMessage): Promise<void> {
    // Verificar se mensagem já foi enviada
    if (this.isMessageAlreadySent(message.tenantId, message.messageId)) {
      this.logger.info?.('Message already sent, skipping to prevent duplicate', {
        tenantId: message.tenantId.substring(0, 8) + '***',
        messageId: message.messageId.substring(0, 8) + '***',
        from: message.from.substring(0, 6) + '***'
      });
      return;
    }

    const webhook = this.webhooks.get(message.tenantId);
    
    if (!webhook || !webhook.active || !webhook.events.includes('message')) {
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
        caption: message.caption,
        ...(message.messageReplied && { messageReplied: message.messageReplied })
      }
    };

    // Marcar mensagem como sendo enviada ANTES do envio
    this.markMessageAsSent(message.tenantId, message.messageId);

    try {
      await this.sendWebhook(webhook, webhookPayload, message.tenantId);
      
      this.logger.info?.('Message webhook sent successfully', {
        tenantId: message.tenantId.substring(0, 8) + '***',
        messageId: message.messageId.substring(0, 8) + '***',
        webhookUrl: webhook.url.substring(0, 30) + '***'
      });
    } catch (error: any) {
      this.logger.error?.('Failed to send message webhook', {
        tenantId: message.tenantId.substring(0, 8) + '***',
        messageId: message.messageId.substring(0, 8) + '***',
        error: error.message
      });
      
      // Em caso de erro, remover da cache para permitir retry posterior
      const messageKey = `${message.tenantId}_${message.messageId}`;
      this.sentMessages.delete(messageKey);
    }
  }

  async processStatusChange(statusChange: StatusChange): Promise<void> {
    const webhook = this.webhooks.get(statusChange.tenantId);
    
    if (!webhook || !webhook.active || !webhook.events.includes('status')) {
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

    await this.sendWebhook(webhook, webhookPayload, statusChange.tenantId);
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
        timeout: 8000, // 8 segundos
        maxRedirects: 2,
        validateStatus: (status) => status < 500 // 4xx não é erro
      });

      // Atualizar estatísticas de sucesso
      this.updateWebhookStats(tenantId, true, Date.now() - startTime);
      
      if (webhook.successCount !== undefined) {
        webhook.successCount++;
      }
      webhook.lastUsed = new Date();

      this.logger.info?.('Webhook sent successfully', {
        tenantId: tenantId.substring(0, 8) + '***',
        webhookId: webhook.id,
        status: response.status,
        responseTime: Date.now() - startTime
      });

    } catch (error: any) {
      // Atualizar estatísticas de erro
      this.updateWebhookStats(tenantId, false, Date.now() - startTime);
      
      if (webhook.errorCount !== undefined) {
        webhook.errorCount++;
      }

      // Retry logic - máximo 2 tentativas
      if (retryCount < 2 && this.shouldRetry(error)) {
        const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Backoff exponencial, max 5s
        
        this.logger.warn?.('Webhook failed, retrying...', {
          tenantId: tenantId.substring(0, 8) + '***',
          retryCount: retryCount + 1,
          retryDelay,
          error: error.message
        });

        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.sendWebhook(webhook, payload, tenantId, retryCount + 1);
      }

      this.logger.error?.('Webhook failed after retries', {
        tenantId: tenantId.substring(0, 8) + '***',
        webhookId: webhook.id,
        url: webhook.url,
        error: error.message,
        retryCount
      });

      throw error; // Re-throw para ser capturado pelo caller
    }
  }

  private shouldRetry(error: any): boolean {
    // Retry em casos de timeout, conexão ou erro 5xx
    return (
      error.code === 'ECONNABORTED' || // Timeout
      error.code === 'ECONNREFUSED' || // Conexão recusada
      error.code === 'ENOTFOUND' ||    // DNS não encontrado
      (error.response && error.response.status >= 500) // Erro servidor
    );
  }

  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  private updateWebhookStats(tenantId: string, success: boolean, responseTime: number): void {
    let stats = this.stats.get(tenantId);
    
    if (!stats) {
      stats = {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageResponseTime: 0,
        uptime: 0
      };
    }

    stats.totalCalls++;
    stats.lastCall = new Date();
    
    if (success) {
      stats.successfulCalls++;
    } else {
      stats.failedCalls++;
    }

    // Calcular média móvel do tempo de resposta
    stats.averageResponseTime = (
      (stats.averageResponseTime * (stats.totalCalls - 1) + responseTime) / stats.totalCalls
    );

    stats.uptime = stats.totalCalls > 0 ? (stats.successfulCalls / stats.totalCalls) * 100 : 0;

    this.stats.set(tenantId, stats);
  }

  async getWebhookStats(tenantId: string): Promise<WebhookStats | null> {
    return this.stats.get(tenantId) || null;
  }

  async testWebhook(tenantId: string): Promise<{
    success: boolean;
    responseTime: number;
    status?: number;
    error?: string;
  }> {
    const webhook = this.webhooks.get(tenantId);
    if (!webhook) {
      return {
        success: false,
        responseTime: 0,
        error: 'No webhook configured for tenant'
      };
    }

    const testPayload = {
      event: 'test',
      timestamp: Date.now(),
      tenantId,
      data: {
        message: 'Test webhook connection',
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
        timeout: 5000,
        validateStatus: (status) => status < 500
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

  // 🔴 NOVO: Métodos para debugging
  async getSentMessagesCache(): Promise<{ messageKey: string; timestamp: number; age: string }[]> {
    const now = Date.now();
    const cache = Array.from(this.sentMessages.entries()).map(([key, timestamp]) => ({
      messageKey: key.replace(/^[^_]+_/, '***_'), // Ocultar tenant ID
      timestamp,
      age: `${Math.round((now - timestamp) / 1000)}s ago`
    }));
    
    return cache.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getWebhookSummary(): Promise<{
    totalTenants: number;
    totalWebhooks: number;
    cacheSize: number;
    oldestCacheEntry: string | null;
  }> {
    const now = Date.now();
    let oldestTimestamp = now;
    
    for (const timestamp of this.sentMessages.values()) {
      if (timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
      }
    }

    return {
      totalTenants: this.webhooks.size,
      totalWebhooks: this.webhooks.size, // Sempre igual agora (1 webhook por tenant)
      cacheSize: this.sentMessages.size,
      oldestCacheEntry: oldestTimestamp < now ? 
        `${Math.round((now - oldestTimestamp) / 1000)}s ago` : null
    };
  }
}