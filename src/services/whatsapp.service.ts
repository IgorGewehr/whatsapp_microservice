import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  WASocket, 
  proto,
  WAMessageContent,
  WAMessageKey,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Logger } from 'pino';
import { config } from '../config/config';
import NodeCache from 'node-cache';
import { PersistentQRService } from './persistent-qr.service';

export interface WhatsAppSession {
  socket: WASocket | null;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  qrCode: string | null;
  phoneNumber: string | null;
  businessName: string | null;
  lastActivity: Date;
  reconnectAttempts: number;
  sessionId: string;
}

export interface MessageData {
  to: string;
  message: string;
  type?: 'text' | 'image' | 'video' | 'document';
  mediaUrl?: string;
  caption?: string;
  fileName?: string;
}

export class WhatsAppService extends EventEmitter {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private cache: NodeCache;
  private logger: Logger;
  private sessionDir: string;
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private persistentQRService: PersistentQRService;
  private processedMessages: Set<string> = new Set(); // Cache de mensagens processadas

  constructor(logger: Logger) {
    super();
    this.logger = (logger as any).child({ service: 'WhatsAppService' });
    this.sessionDir = config.WHATSAPP_SESSION_DIR;
    this.cache = new NodeCache({ 
      stdTTL: config.CACHE_TTL,
      checkperiod: 60,
      useClones: false
    });
    
    // OPTIMIZED: Initialize persistent QR service
    this.persistentQRService = new PersistentQRService(this.logger, this);
    
    this.ensureSessionDirectory();
    this.startCleanupInterval();
    this.startMessageCleanup();
    
    console.log(`WhatsApp Service initialized (sessionDir: ${this.sessionDir}, cacheTTL: ${config.CACHE_TTL})`);
  }

  private ensureSessionDirectory(): void {
    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
        console.log('Session directory created', { path: this.sessionDir });
      }
      
      // Testar permissões de escrita
      const testFile = path.join(this.sessionDir, '.test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      
    } catch (error: unknown) {
      console.log('Failed to setup session directory:', error);
      const err = error as Error;
      throw new Error(`Cannot setup session directory: ${err.message}`);
    }
  }

  private startCleanupInterval(): void {
    // Limpeza de sessões inativas a cada 30 minutos
    setInterval(() => {
      const now = Date.now();
      for (const [tenantId, session] of this.sessions.entries()) {
        const inactiveTime = now - session.lastActivity.getTime();
        // Remove sessões desconectadas há mais de 1 hora
        if (inactiveTime > 60 * 60 * 1000 && session.status === 'disconnected') {
          console.log('Cleaning up inactive session', { tenantId });
          this.cleanupSession(tenantId);
        }
      }
    }, 30 * 60 * 1000);
  }

  private startMessageCleanup(): void {
    // Limpeza de mensagens processadas a cada 5 minutos
    setInterval(() => {
      const maxSize = 1000; // Manter apenas as últimas 1000 mensagens
      if (this.processedMessages.size > maxSize) {
        console.log(`Cleaning up processed messages cache (size: ${this.processedMessages.size})`);
        // Converter para array, manter apenas as últimas
        const messages = Array.from(this.processedMessages);
        this.processedMessages.clear();
        messages.slice(-500).forEach(msgId => this.processedMessages.add(msgId));
        console.log(`Processed messages cache cleaned (new size: ${this.processedMessages.size})`);
      }
    }, 5 * 60 * 1000);
  }

  async startSession(tenantId: string): Promise<{
    success: boolean;
    sessionId: string;
    qrCode?: string;
    message: string;
  }> {
    try {
      console.log('🚀 [Session Start] Starting WhatsApp session with persistent QR', { 
        tenantId: tenantId.substring(0, 8) + '***',
        timestamp: new Date().toISOString()
      });

      // Verificar se já existe uma sessão ativa
      const existingSession = this.sessions.get(tenantId);
      if (existingSession && existingSession.status === 'connected') {
        console.log('✅ [Session Start] Session already connected', {
          tenantId: tenantId.substring(0, 8) + '***',
          sessionId: existingSession.sessionId.substring(0, 8) + '***'
        });
        
        return {
          success: true,
          sessionId: existingSession.sessionId,
          message: 'Session already connected'
        };
      }

      // Limpar sessão existente se houver
      if (existingSession) {
        console.log('🔄 [Session Start] Cleaning existing session', {
          tenantId: tenantId.substring(0, 8) + '***'
        });
        await this.disconnectSession(tenantId);
      }

      // OPTIMIZED: Start persistent QR before creating session
      console.log('🔄 [Session Start] Starting persistent QR service', {
        tenantId: tenantId.substring(0, 8) + '***'
      });

      // Criar nova sessão
      const sessionId = `${tenantId}_${Date.now()}`;
      const session: WhatsAppSession = {
        socket: null,
        status: 'connecting',
        qrCode: null,
        phoneNumber: null,
        businessName: null,
        lastActivity: new Date(),
        reconnectAttempts: 0,
        sessionId
      };

      this.sessions.set(tenantId, session);

      // ✅ EMIT SESSION CREATED EVENT FOR AUTO-WEBHOOK REGISTRATION
      this.emit('session_created', tenantId);

      // FIXED: Create Baileys connection first, then start persistent QR
      console.log('🔧 [Session Start] Creating Baileys connection first', {
        tenantId: tenantId.substring(0, 8) + '***'
      });
      
      await this.createBaileysConnection(tenantId);
      
      console.log('✅ [Session Start] Baileys ready, now starting persistent QR', {
        tenantId: tenantId.substring(0, 8) + '***'
      });

      // Now start persistent QR service after Baileys is ready
      try {
        const persistentQR = await this.persistentQRService.startPersistentQR(tenantId);
        
        if (persistentQR) {
          session.qrCode = persistentQR;
          session.status = 'qr';
          
          console.log('✅ [Session Start] Persistent QR generated successfully', {
            tenantId: tenantId.substring(0, 8) + '***',
            qrLength: persistentQR.length
          });
        } else {
          console.log('ℹ️ [Session Start] No immediate QR, will generate when Baileys emits QR', {
            tenantId: tenantId.substring(0, 8) + '***'
          });
        }
      } catch (error) {
        console.log('⚠️ [Session Start] Persistent QR failed, Baileys will handle QR generation', {
          tenantId: tenantId.substring(0, 8) + '***',
          error: error.message
        });
      }

      return {
        success: true,
        sessionId,
        message: 'Session initialization started'
      };

    } catch (error: unknown) {
      console.log('Failed to start session:', error);
      throw error;
    }
  }

  private async createBaileysConnection(tenantId: string): Promise<void> {
    const session = this.sessions.get(tenantId);
    if (!session) {
      throw new Error('Session not found');
    }

    try {
      console.log('🔧 [Baileys] Starting optimized connection creation', {
        tenantId: tenantId.substring(0, 8) + '***',
        timestamp: new Date().toISOString()
      });

      // OPTIMIZED: Pre-warm directory and version fetching in parallel
      const authDir = path.join(this.sessionDir, tenantId);
      
      const [versionResult, authDirResult] = await Promise.allSettled([
        fetchLatestBaileysVersion(),
        this.ensureAuthDirectory(authDir)
      ]);

      // Check results
      if (versionResult.status === 'rejected') {
        console.log('❌ [Baileys] Version fetch failed', {
          tenantId: tenantId.substring(0, 8) + '***',
          error: versionResult.reason
        });
        throw new Error('Failed to fetch Baileys version');
      }

      if (authDirResult.status === 'rejected') {
        console.log('❌ [Baileys] Auth directory creation failed', {
          tenantId: tenantId.substring(0, 8) + '***',
          error: authDirResult.reason
        });
        throw new Error('Failed to create auth directory');
      }

      const { version } = versionResult.value;
      console.log('✅ [Baileys] Version and directory ready', {
        version,
        tenantId: tenantId.substring(0, 8) + '***',
        authDir: authDir.replace(tenantId, '***')
      });

      // OPTIMIZED: Pre-warm auth state loading
      const authStateStart = Date.now();
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      
      console.log('✅ [Baileys] Auth state loaded', {
        tenantId: tenantId.substring(0, 8) + '***',
        duration: `${Date.now() - authStateStart}ms`,
        hasExistingCreds: !!state.creds.me
      });

      // OPTIMIZED: Create socket with performance config
      const socketStart = Date.now();
      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger as any)
        },
        logger: (this.logger as any).child({ module: 'baileys', tenantId }),
        browser: ['LocAI WhatsApp Service', 'Chrome', '120.0.0'], // Optimized browser info
        connectTimeoutMs: 60000, // Increased timeout
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 1000,
        ...config.BAILEYS_CONFIG
      });

      session.socket = socket;
      
      console.log('✅ [Baileys] Socket created successfully', {
        tenantId: tenantId.substring(0, 8) + '***',
        socketDuration: `${Date.now() - socketStart}ms`,
        browser: 'LocAI WhatsApp Service'
      });

      // Handler para atualizações de conexão
      socket.ev.on('connection.update', async (update) => {
        await this.handleConnectionUpdate(tenantId, update);
      });

      // Handler para atualização de credenciais
      socket.ev.on('creds.update', () => {
        saveCreds().catch((error) => {
          console.log('Failed to save credentials:', error);
        });
      });

      // Handler para mensagens recebidas
      socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
          await this.handleIncomingMessages(tenantId, messages);
        }
      });

      console.log({ tenantId }, 'Baileys socket created successfully');

    } catch (error: unknown) {
      console.log('Failed to create Baileys connection:', error);
      session.status = 'disconnected';
      throw error;
    }
  }

  private async handleConnectionUpdate(tenantId: string, update: any): Promise<void> {
    const session = this.sessions.get(tenantId);
    if (!session) return;

    const { connection, lastDisconnect, qr } = update;

    console.log(`🔄 [Connection] Update received for tenant ${tenantId.substring(0, 8)}***: connection=${connection}, hasQr=${!!qr}`);

    // OPTIMIZED: QR Code generation with persistent service integration
    if (qr) {
      try {
        const qrGenStart = Date.now();
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 4,
          width: 512,
          errorCorrectionLevel: 'H',
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        } as any);

        session.qrCode = qrDataUrl;
        session.status = 'qr';
        session.lastActivity = new Date();

        // OPTIMIZED: Use cache as backup, rely on persistent service
        this.cache.set(`qr_${tenantId}`, qrDataUrl, config.QR_TIMEOUT / 1000);

        this.emit('qr', tenantId, qrDataUrl);
        
        console.log('✅ [Connection] QR Code generated and integrated', {
          tenantId: tenantId.substring(0, 8) + '***',
          qrLength: qrDataUrl.length,
          generationTime: `${Date.now() - qrGenStart}ms`,
          persistentService: 'integrated'
        });

      } catch (error: unknown) {
        console.log(error, 'Failed to generate QR code');
        // Usar QR raw como fallback
        session.qrCode = qr;
        session.status = 'qr';
        this.emit('qr', tenantId, qr);
      }
    }

    // OPTIMIZED: Connection opened (successfully connected)
    if (connection === 'open') {
      session.status = 'connected';
      session.qrCode = null;
      session.reconnectAttempts = 0;

      // Obter informações do usuário
      if (session.socket?.user) {
        session.phoneNumber = session.socket.user.id.split(':')[0];
        session.businessName = session.socket.user.name || 'WhatsApp Business';
      }

      session.lastActivity = new Date();

      // OPTIMIZED: Stop persistent QR service and clean cache
      this.persistentQRService.markAsConnected(tenantId);
      this.cache.del(`qr_${tenantId}`);

      // Limpar timer de reconexão se houver
      const timer = this.reconnectTimers.get(tenantId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(tenantId);
      }

      this.emit('connected', tenantId, session.phoneNumber);
      
      console.log('✅ [Connection] WhatsApp connected successfully', {
        tenantId: tenantId.substring(0, 8) + '***',
        phone: session.phoneNumber?.substring(0, 6) + '***',
        business: session.businessName,
        persistentQRStopped: true
      }, 'WhatsApp connected successfully');
    }

    // Conexão fechada
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log({
        tenantId,
        shouldReconnect,
        reconnectAttempts: session.reconnectAttempts,
        maxAttempts: config.MAX_RECONNECT_ATTEMPTS
      }, 'Connection closed');

      if (shouldReconnect && session.reconnectAttempts < config.MAX_RECONNECT_ATTEMPTS) {
        // Tentar reconectar com backoff exponencial
        session.reconnectAttempts++;
        const delay = Math.min(5000 * Math.pow(2, session.reconnectAttempts - 1), 30000);

        console.log({
          tenantId,
          attempt: session.reconnectAttempts,
          delay
        }, 'Scheduling reconnection');

        const timer = setTimeout(() => {
          this.createBaileysConnection(tenantId).catch((error) => {
            console.log('Reconnection failed:', error);
            session.status = 'disconnected';
          });
        }, delay);

        this.reconnectTimers.set(tenantId, timer);

      } else {
        session.status = 'disconnected';
        this.emit('disconnected', tenantId, 'Connection lost');

        if ((lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.loggedOut) {
          // Limpar dados de sessão se foi deslogado
          await this.clearSessionData(tenantId);
        }
      }
    }
  }

  private async handleIncomingMessages(tenantId: string, messages: proto.IWebMessageInfo[]): Promise<void> {
    for (const message of messages) {
      if (!message.key.fromMe && message.message && message.key.id) {
        // ===== FILTRO ANTI-DUPLICAÇÃO =====
        const messageKey = `${tenantId}_${message.key.remoteJid}_${message.key.id}`;
        
        if (this.processedMessages.has(messageKey)) {
          console.log('🔄 [WhatsApp] Message already processed, skipping', {
            tenantId: tenantId.substring(0, 8) + '***',
            messageId: message.key.id?.substring(0, 8) + '***',
            from: message.key.remoteJid?.replace('@s.whatsapp.net', '').substring(0, 6) + '***'
          });
          continue; // Pular mensagem duplicada
        }
        
        // Marcar mensagem como processada ANTES de processar
        this.processedMessages.add(messageKey);

        const session = this.sessions.get(tenantId);
        if (session) {
          session.lastActivity = new Date();
        }

        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || '';
        
        // Filtrar mensagens vazias
        if (!messageText.trim()) {
          console.log('⚠️ [WhatsApp] Empty message, skipping', {
            tenantId: tenantId.substring(0, 8) + '***',
            messageId: message.key.id?.substring(0, 8) + '***'
          });
          continue;
        }

        console.log('📨 [WhatsApp] Processing new message', {
          tenantId: tenantId.substring(0, 8) + '***',
          from: message.key.remoteJid?.replace('@s.whatsapp.net', '').substring(0, 6) + '***',
          messageId: message.key.id?.substring(0, 8) + '***',
          messageLength: messageText.length,
          timestamp: message.messageTimestamp
        });

        // Emitir evento para webhook
        this.emit('message', tenantId, {
          from: message.key.remoteJid?.replace('@s.whatsapp.net', ''),
          id: message.key.id,
          timestamp: message.messageTimestamp,
          text: messageText,
          type: 'text'
        });
      }
    }
  }

  async sendMessage(tenantId: string, messageData: MessageData): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const session = this.sessions.get(tenantId);
      if (!session || !session.socket || session.status !== 'connected') {
        return {
          success: false,
          error: 'WhatsApp session not connected'
        };
      }

      const jid = messageData.to.includes('@') ? messageData.to : `${messageData.to}@s.whatsapp.net`;
      let content: any;

      if (messageData.type === 'image' && messageData.mediaUrl) {
        // Baixar e enviar imagem
        const response = await fetch(messageData.mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        
        content = {
          image: Buffer.from(buffer),
          caption: messageData.caption || messageData.message
        };
      } else if (messageData.type === 'video' && messageData.mediaUrl) {
        // Baixar e enviar vídeo
        const response = await fetch(messageData.mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch video: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        
        content = {
          video: Buffer.from(buffer),
          caption: messageData.caption || messageData.message
        };
      } else if (messageData.type === 'document' && messageData.mediaUrl) {
        // Baixar e enviar documento
        const response = await fetch(messageData.mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch document: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        
        content = {
          document: Buffer.from(buffer),
          fileName: messageData.fileName || 'document',
          caption: messageData.caption || messageData.message
        };
      } else {
        // Mensagem de texto
        content = { text: messageData.message };
      }

      const sentMessage = await session.socket.sendMessage(jid, content);
      session.lastActivity = new Date();

      console.log({
        tenantId,
        to: messageData.to.substring(0, 6) + '***',
        type: messageData.type || 'text',
        messageId: sentMessage?.key?.id
      }, 'Message sent successfully');

      return {
        success: true,
        messageId: sentMessage?.key?.id || undefined
      };

    } catch (error: unknown) {
      console.log(error, 'Failed to send message');
      const err = error as Error;
      return {
        success: false,
        error: err.message
      };
    }
  }

  async getSessionStatus(tenantId: string): Promise<{
    connected: boolean;
    status: string;
    phoneNumber?: string;
    businessName?: string;
    qrCode?: string;
    sessionId?: string;
    lastActivity?: string;
  }> {
    const session = this.sessions.get(tenantId);
    
    if (!session) {
      return {
        connected: false,
        status: 'not_found'
      };
    }

    // OPTIMIZED: Get QR from persistent service instead of cache
    const persistentQR = this.persistentQRService.getCurrentQR(tenantId);
    
    // Update session QR if we have a fresh one from persistent service
    if (persistentQR && persistentQR !== session.qrCode) {
      session.qrCode = persistentQR;
      session.status = 'qr';
      
      console.log('🔄 [Status] Updated session with fresh persistent QR', {
        tenantId: tenantId.substring(0, 8) + '***',
        qrLength: persistentQR.length
      });
    }

    return {
      connected: session.status === 'connected',
      status: session.status,
      phoneNumber: session.phoneNumber || undefined,
      businessName: session.businessName || undefined,
      qrCode: session.qrCode || persistentQR || undefined,
      sessionId: session.sessionId,
      lastActivity: session.lastActivity.toISOString()
    };
  }

  /**
   * OPTIMIZED: Get current QR code for persistent service integration
   */
  async getSessionQR(tenantId: string): Promise<{ qrCode?: string }> {
    const session = this.sessions.get(tenantId);
    
    if (!session) {
      console.log('⚠️ [QR Request] No session found', {
        tenantId: tenantId.substring(0, 8) + '***'
      });
      return {};
    }

    // Return current QR from session
    if (session.qrCode) {
      console.log('✅ [QR Request] Returning existing QR', {
        tenantId: tenantId.substring(0, 8) + '***',
        qrLength: session.qrCode.length
      });
      return { qrCode: session.qrCode };
    }

    console.log('ℹ️ [QR Request] No QR available in session', {
      tenantId: tenantId.substring(0, 8) + '***',
      status: session.status
    });
    
    return {};
  }

  /**
   * OPTIMIZED: Ensure auth directory exists with error handling
   */
  private async ensureAuthDirectory(authDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(authDir)) {
        fs.mkdir(authDir, { recursive: true }, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  async disconnectSession(tenantId: string): Promise<{ success: boolean; message: string }> {
    try {
      const session = this.sessions.get(tenantId);
      if (!session) {
        return { success: true, message: 'Session not found' };
      }

      // Desconectar socket se estiver ativo
      if (session.socket) {
        try {
          await session.socket.logout();
        } catch (error: unknown) {
          console.log(error, 'Error during logout');
        }
      }

      // Limpar timer de reconexão
      const timer = this.reconnectTimers.get(tenantId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(tenantId);
      }

      // Limpar dados da sessão
      await this.clearSessionData(tenantId);
      this.cleanupSession(tenantId);

      console.log({ tenantId }, 'Session disconnected successfully');
      
      return { success: true, message: 'Session disconnected' };

    } catch (error: unknown) {
      console.log(error, 'Failed to disconnect session');
      const err = error as Error;
      return { success: false, message: err.message };
    }
  }

  private async clearSessionData(tenantId: string): Promise<void> {
    try {
      const sessionPath = path.join(this.sessionDir, tenantId);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log({ tenantId, path: sessionPath }, 'Session data cleared');
      }
    } catch (error: unknown) {
      console.log(error, 'Failed to clear session data');
    }
  }

  private cleanupSession(tenantId: string): void {
    this.sessions.delete(tenantId);
    this.cache.del(`qr_${tenantId}`);
  }

  async disconnectAllSessions(): Promise<void> {
    const tenants = Array.from(this.sessions.keys());
    console.log({ count: tenants.length }, 'Disconnecting all sessions');

    const promises = tenants.map(tenantId => this.disconnectSession(tenantId));
    await Promise.allSettled(promises);

    console.log('All sessions disconnected');
  }

  getActiveSessions(): Array<{
    tenantId: string;
    status: string;
    phoneNumber?: string;
    lastActivity: string;
  }> {
    return Array.from(this.sessions.entries()).map(([tenantId, session]) => ({
      tenantId,
      status: session.status,
      phoneNumber: session.phoneNumber || undefined,
      lastActivity: session.lastActivity.toISOString()
    }));
  }
}