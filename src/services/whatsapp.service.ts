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

  constructor(logger: Logger) {
    super();
    this.logger = logger.child({ service: 'WhatsAppService' });
    this.sessionDir = config.WHATSAPP_SESSION_DIR;
    this.cache = new NodeCache({ 
      stdTTL: config.CACHE_TTL,
      checkperiod: 60,
      useClones: false
    });
    
    this.ensureSessionDirectory();
    this.startCleanupInterval();
    
    this.logger.info('WhatsApp Service initialized', {
      sessionDir: this.sessionDir,
      cacheSettings: { ttl: config.CACHE_TTL }
    });
  }

  private ensureSessionDirectory(): void {
    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
        this.logger.info('Session directory created', { path: this.sessionDir });
      }
      
      // Testar permissões de escrita
      const testFile = path.join(this.sessionDir, '.test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      
    } catch (error) {
      this.logger.error('Failed to setup session directory:', error);
      throw new Error(`Cannot setup session directory: ${error.message}`);
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
          this.logger.info('Cleaning up inactive session', { tenantId });
          this.cleanupSession(tenantId);
        }
      }
    }, 30 * 60 * 1000);
  }

  async startSession(tenantId: string): Promise<{
    success: boolean;
    sessionId: string;
    qrCode?: string;
    message: string;
  }> {
    try {
      this.logger.info('Starting WhatsApp session', { tenantId });

      // Verificar se já existe uma sessão ativa
      const existingSession = this.sessions.get(tenantId);
      if (existingSession && existingSession.status === 'connected') {
        return {
          success: true,
          sessionId: existingSession.sessionId,
          message: 'Session already connected'
        };
      }

      // Limpar sessão existente se houver
      if (existingSession) {
        await this.disconnectSession(tenantId);
      }

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

      // Iniciar conexão Baileys
      await this.createBaileysConnection(tenantId);

      return {
        success: true,
        sessionId,
        message: 'Session initialization started'
      };

    } catch (error) {
      this.logger.error('Failed to start session:', error);
      throw error;
    }
  }

  private async createBaileysConnection(tenantId: string): Promise<void> {
    const session = this.sessions.get(tenantId);
    if (!session) {
      throw new Error('Session not found');
    }

    try {
      // Configurar diretório de autenticação
      const authDir = path.join(this.sessionDir, tenantId);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      // Buscar versão mais recente do Baileys
      const { version } = await fetchLatestBaileysVersion();
      this.logger.info('Using Baileys version', { version, tenantId });

      // Configurar estado de autenticação
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      // Criar socket WhatsApp
      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        logger: this.logger.child({ module: 'baileys', tenantId }),
        ...config.BAILEYS_CONFIG
      });

      session.socket = socket;

      // Handler para atualizações de conexão
      socket.ev.on('connection.update', async (update) => {
        await this.handleConnectionUpdate(tenantId, update);
      });

      // Handler para atualização de credenciais
      socket.ev.on('creds.update', () => {
        saveCreds().catch((error) => {
          this.logger.error('Failed to save credentials:', error);
        });
      });

      // Handler para mensagens recebidas
      socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
          await this.handleIncomingMessages(tenantId, messages);
        }
      });

      this.logger.info('Baileys socket created successfully', { tenantId });

    } catch (error) {
      this.logger.error('Failed to create Baileys connection:', error);
      session.status = 'disconnected';
      throw error;
    }
  }

  private async handleConnectionUpdate(tenantId: string, update: any): Promise<void> {
    const session = this.sessions.get(tenantId);
    if (!session) return;

    const { connection, lastDisconnect, qr } = update;

    this.logger.info('Connection update received', {
      tenantId,
      connection,
      hasQr: !!qr,
      qrLength: qr?.length
    });

    // QR Code gerado
    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          type: 'image/png',
          quality: 1.0,
          margin: 4,
          width: 512,
          errorCorrectionLevel: 'H',
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });

        session.qrCode = qrDataUrl;
        session.status = 'qr';
        session.lastActivity = new Date();

        // Salvar no cache para acesso rápido
        this.cache.set(`qr_${tenantId}`, qrDataUrl, config.QR_TIMEOUT / 1000);

        this.emit('qr', tenantId, qrDataUrl);
        this.logger.info('QR Code generated successfully', { tenantId });

      } catch (error) {
        this.logger.error('Failed to generate QR code:', error);
        // Usar QR raw como fallback
        session.qrCode = qr;
        session.status = 'qr';
        this.emit('qr', tenantId, qr);
      }
    }

    // Conexão aberta (conectado com sucesso)
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

      // Limpar QR do cache
      this.cache.del(`qr_${tenantId}`);

      // Limpar timer de reconexão se houver
      const timer = this.reconnectTimers.get(tenantId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(tenantId);
      }

      this.emit('connected', tenantId, session.phoneNumber);
      this.logger.info('WhatsApp connected successfully', {
        tenantId,
        phone: session.phoneNumber,
        business: session.businessName
      });
    }

    // Conexão fechada
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

      this.logger.info('Connection closed', {
        tenantId,
        shouldReconnect,
        reconnectAttempts: session.reconnectAttempts,
        maxAttempts: config.MAX_RECONNECT_ATTEMPTS
      });

      if (shouldReconnect && session.reconnectAttempts < config.MAX_RECONNECT_ATTEMPTS) {
        // Tentar reconectar com backoff exponencial
        session.reconnectAttempts++;
        const delay = Math.min(5000 * Math.pow(2, session.reconnectAttempts - 1), 30000);

        this.logger.info('Scheduling reconnection', {
          tenantId,
          attempt: session.reconnectAttempts,
          delay
        });

        const timer = setTimeout(() => {
          this.createBaileysConnection(tenantId).catch((error) => {
            this.logger.error('Reconnection failed:', error);
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
      if (!message.key.fromMe && message.message) {
        const session = this.sessions.get(tenantId);
        if (session) {
          session.lastActivity = new Date();
        }

        // Emitir evento para webhook
        this.emit('message', tenantId, {
          from: message.key.remoteJid?.replace('@s.whatsapp.net', ''),
          id: message.key.id,
          timestamp: message.messageTimestamp,
          text: message.message.conversation || 
                message.message.extendedTextMessage?.text || '',
          type: 'text'
        });

        this.logger.info('Message received', {
          tenantId,
          from: message.key.remoteJid?.replace('@s.whatsapp.net', '').substring(0, 6) + '***',
          messageId: message.key.id
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
      let content: WAMessageContent;

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

      this.logger.info('Message sent successfully', {
        tenantId,
        to: messageData.to.substring(0, 6) + '***',
        type: messageData.type || 'text',
        messageId: sentMessage?.key?.id
      });

      return {
        success: true,
        messageId: sentMessage?.key?.id
      };

    } catch (error) {
      this.logger.error('Failed to send message:', error);
      return {
        success: false,
        error: error.message
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

    // Buscar QR code do cache se disponível
    const cachedQr = this.cache.get<string>(`qr_${tenantId}`);

    return {
      connected: session.status === 'connected',
      status: session.status,
      phoneNumber: session.phoneNumber || undefined,
      businessName: session.businessName || undefined,
      qrCode: session.qrCode || cachedQr || undefined,
      sessionId: session.sessionId,
      lastActivity: session.lastActivity.toISOString()
    };
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
        } catch (error) {
          this.logger.warn('Error during logout:', error);
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

      this.logger.info('Session disconnected successfully', { tenantId });
      
      return { success: true, message: 'Session disconnected' };

    } catch (error) {
      this.logger.error('Failed to disconnect session:', error);
      return { success: false, message: error.message };
    }
  }

  private async clearSessionData(tenantId: string): Promise<void> {
    try {
      const sessionPath = path.join(this.sessionDir, tenantId);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        this.logger.info('Session data cleared', { tenantId, path: sessionPath });
      }
    } catch (error) {
      this.logger.error('Failed to clear session data:', error);
    }
  }

  private cleanupSession(tenantId: string): void {
    this.sessions.delete(tenantId);
    this.cache.del(`qr_${tenantId}`);
  }

  async disconnectAllSessions(): Promise<void> {
    const tenants = Array.from(this.sessions.keys());
    this.logger.info('Disconnecting all sessions', { count: tenants.length });

    const promises = tenants.map(tenantId => this.disconnectSession(tenantId));
    await Promise.allSettled(promises);

    this.logger.info('All sessions disconnected');
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