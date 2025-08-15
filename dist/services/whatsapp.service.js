"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const qrcode_1 = __importDefault(require("qrcode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const events_1 = require("events");
const config_1 = require("../config/config");
const node_cache_1 = __importDefault(require("node-cache"));
const persistent_qr_service_1 = require("./persistent-qr.service");
class WhatsAppService extends events_1.EventEmitter {
    constructor(logger) {
        super();
        this.sessions = new Map();
        this.reconnectTimers = new Map();
        this.logger = logger.child({ service: 'WhatsAppService' });
        this.sessionDir = config_1.config.WHATSAPP_SESSION_DIR;
        this.cache = new node_cache_1.default({
            stdTTL: config_1.config.CACHE_TTL,
            checkperiod: 60,
            useClones: false
        });
        this.persistentQRService = new persistent_qr_service_1.PersistentQRService(this.logger, this);
        this.ensureSessionDirectory();
        this.startCleanupInterval();
        console.log(`WhatsApp Service initialized (sessionDir: ${this.sessionDir}, cacheTTL: ${config_1.config.CACHE_TTL})`);
    }
    ensureSessionDirectory() {
        try {
            if (!fs.existsSync(this.sessionDir)) {
                fs.mkdirSync(this.sessionDir, { recursive: true });
                console.log('Session directory created', { path: this.sessionDir });
            }
            const testFile = path.join(this.sessionDir, '.test');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
        }
        catch (error) {
            console.log('Failed to setup session directory:', error);
            const err = error;
            throw new Error(`Cannot setup session directory: ${err.message}`);
        }
    }
    startCleanupInterval() {
        setInterval(() => {
            const now = Date.now();
            for (const [tenantId, session] of this.sessions.entries()) {
                const inactiveTime = now - session.lastActivity.getTime();
                if (inactiveTime > 60 * 60 * 1000 && session.status === 'disconnected') {
                    console.log('Cleaning up inactive session', { tenantId });
                    this.cleanupSession(tenantId);
                }
            }
        }, 30 * 60 * 1000);
    }
    async startSession(tenantId) {
        try {
            console.log('🚀 [Session Start] Starting WhatsApp session with persistent QR', {
                tenantId: tenantId.substring(0, 8) + '***',
                timestamp: new Date().toISOString()
            });
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
            if (existingSession) {
                console.log('🔄 [Session Start] Cleaning existing session', {
                    tenantId: tenantId.substring(0, 8) + '***'
                });
                await this.disconnectSession(tenantId);
            }
            console.log('🔄 [Session Start] Starting persistent QR service', {
                tenantId: tenantId.substring(0, 8) + '***'
            });
            const sessionId = `${tenantId}_${Date.now()}`;
            const session = {
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
            console.log('🔧 [Session Start] Creating Baileys connection first', {
                tenantId: tenantId.substring(0, 8) + '***'
            });
            await this.createBaileysConnection(tenantId);
            console.log('✅ [Session Start] Baileys ready, now starting persistent QR', {
                tenantId: tenantId.substring(0, 8) + '***'
            });
            try {
                const persistentQR = await this.persistentQRService.startPersistentQR(tenantId);
                if (persistentQR) {
                    session.qrCode = persistentQR;
                    session.status = 'qr';
                    console.log('✅ [Session Start] Persistent QR generated successfully', {
                        tenantId: tenantId.substring(0, 8) + '***',
                        qrLength: persistentQR.length
                    });
                }
                else {
                    console.log('ℹ️ [Session Start] No immediate QR, will generate when Baileys emits QR', {
                        tenantId: tenantId.substring(0, 8) + '***'
                    });
                }
            }
            catch (error) {
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
        }
        catch (error) {
            console.log('Failed to start session:', error);
            throw error;
        }
    }
    async createBaileysConnection(tenantId) {
        const session = this.sessions.get(tenantId);
        if (!session) {
            throw new Error('Session not found');
        }
        try {
            console.log('🔧 [Baileys] Starting optimized connection creation', {
                tenantId: tenantId.substring(0, 8) + '***',
                timestamp: new Date().toISOString()
            });
            const authDir = path.join(this.sessionDir, tenantId);
            const [versionResult, authDirResult] = await Promise.allSettled([
                (0, baileys_1.fetchLatestBaileysVersion)(),
                this.ensureAuthDirectory(authDir)
            ]);
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
            const authStateStart = Date.now();
            const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(authDir);
            console.log('✅ [Baileys] Auth state loaded', {
                tenantId: tenantId.substring(0, 8) + '***',
                duration: `${Date.now() - authStateStart}ms`,
                hasExistingCreds: !!state.creds.me
            });
            const socketStart = Date.now();
            const socket = (0, baileys_1.default)({
                version,
                auth: {
                    creds: state.creds,
                    keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, this.logger)
                },
                logger: this.logger.child({ module: 'baileys', tenantId }),
                browser: ['LocAI WhatsApp Service', 'Chrome', '120.0.0'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                retryRequestDelayMs: 1000,
                ...config_1.config.BAILEYS_CONFIG
            });
            session.socket = socket;
            console.log('✅ [Baileys] Socket created successfully', {
                tenantId: tenantId.substring(0, 8) + '***',
                socketDuration: `${Date.now() - socketStart}ms`,
                browser: 'LocAI WhatsApp Service'
            });
            socket.ev.on('connection.update', async (update) => {
                await this.handleConnectionUpdate(tenantId, update);
            });
            socket.ev.on('creds.update', () => {
                saveCreds().catch((error) => {
                    console.log('Failed to save credentials:', error);
                });
            });
            socket.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type === 'notify') {
                    await this.handleIncomingMessages(tenantId, messages);
                }
            });
            console.log({ tenantId }, 'Baileys socket created successfully');
        }
        catch (error) {
            console.log('Failed to create Baileys connection:', error);
            session.status = 'disconnected';
            throw error;
        }
    }
    async handleConnectionUpdate(tenantId, update) {
        const session = this.sessions.get(tenantId);
        if (!session)
            return;
        const { connection, lastDisconnect, qr } = update;
        console.log(`🔄 [Connection] Update received for tenant ${tenantId.substring(0, 8)}***: connection=${connection}, hasQr=${!!qr}`);
        if (qr) {
            try {
                const qrGenStart = Date.now();
                const qrDataUrl = await qrcode_1.default.toDataURL(qr, {
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
                this.cache.set(`qr_${tenantId}`, qrDataUrl, config_1.config.QR_TIMEOUT / 1000);
                this.emit('qr', tenantId, qrDataUrl);
                console.log('✅ [Connection] QR Code generated and integrated', {
                    tenantId: tenantId.substring(0, 8) + '***',
                    qrLength: qrDataUrl.length,
                    generationTime: `${Date.now() - qrGenStart}ms`,
                    persistentService: 'integrated'
                });
            }
            catch (error) {
                console.log(error, 'Failed to generate QR code');
                session.qrCode = qr;
                session.status = 'qr';
                this.emit('qr', tenantId, qr);
            }
        }
        if (connection === 'open') {
            session.status = 'connected';
            session.qrCode = null;
            session.reconnectAttempts = 0;
            if (session.socket?.user) {
                session.phoneNumber = session.socket.user.id.split(':')[0];
                session.businessName = session.socket.user.name || 'WhatsApp Business';
            }
            session.lastActivity = new Date();
            this.persistentQRService.markAsConnected(tenantId);
            this.cache.del(`qr_${tenantId}`);
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
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== baileys_1.DisconnectReason.loggedOut;
            console.log({
                tenantId,
                shouldReconnect,
                reconnectAttempts: session.reconnectAttempts,
                maxAttempts: config_1.config.MAX_RECONNECT_ATTEMPTS
            }, 'Connection closed');
            if (shouldReconnect && session.reconnectAttempts < config_1.config.MAX_RECONNECT_ATTEMPTS) {
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
            }
            else {
                session.status = 'disconnected';
                this.emit('disconnected', tenantId, 'Connection lost');
                if (lastDisconnect?.error?.output?.statusCode === baileys_1.DisconnectReason.loggedOut) {
                    await this.clearSessionData(tenantId);
                }
            }
        }
    }
    async handleIncomingMessages(tenantId, messages) {
        for (const message of messages) {
            if (!message.key.fromMe && message.message) {
                const session = this.sessions.get(tenantId);
                if (session) {
                    session.lastActivity = new Date();
                }
                this.emit('message', tenantId, {
                    from: message.key.remoteJid?.replace('@s.whatsapp.net', ''),
                    id: message.key.id,
                    timestamp: message.messageTimestamp,
                    text: message.message.conversation ||
                        message.message.extendedTextMessage?.text || '',
                    type: 'text'
                });
                console.log({
                    tenantId,
                    from: message.key.remoteJid?.replace('@s.whatsapp.net', '').substring(0, 6) + '***',
                    messageId: message.key.id
                }, 'Message received');
            }
        }
    }
    async sendMessage(tenantId, messageData) {
        try {
            const session = this.sessions.get(tenantId);
            if (!session || !session.socket || session.status !== 'connected') {
                return {
                    success: false,
                    error: 'WhatsApp session not connected'
                };
            }
            const jid = messageData.to.includes('@') ? messageData.to : `${messageData.to}@s.whatsapp.net`;
            let content;
            if (messageData.type === 'image' && messageData.mediaUrl) {
                const response = await fetch(messageData.mediaUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image: ${response.statusText}`);
                }
                const buffer = await response.arrayBuffer();
                content = {
                    image: Buffer.from(buffer),
                    caption: messageData.caption || messageData.message
                };
            }
            else if (messageData.type === 'video' && messageData.mediaUrl) {
                const response = await fetch(messageData.mediaUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch video: ${response.statusText}`);
                }
                const buffer = await response.arrayBuffer();
                content = {
                    video: Buffer.from(buffer),
                    caption: messageData.caption || messageData.message
                };
            }
            else if (messageData.type === 'document' && messageData.mediaUrl) {
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
            }
            else {
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
        }
        catch (error) {
            console.log(error, 'Failed to send message');
            const err = error;
            return {
                success: false,
                error: err.message
            };
        }
    }
    async getSessionStatus(tenantId) {
        const session = this.sessions.get(tenantId);
        if (!session) {
            return {
                connected: false,
                status: 'not_found'
            };
        }
        const persistentQR = this.persistentQRService.getCurrentQR(tenantId);
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
    async getSessionQR(tenantId) {
        const session = this.sessions.get(tenantId);
        if (!session) {
            console.log('⚠️ [QR Request] No session found', {
                tenantId: tenantId.substring(0, 8) + '***'
            });
            return {};
        }
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
    async ensureAuthDirectory(authDir) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(authDir)) {
                fs.mkdir(authDir, { recursive: true }, (error) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve();
                    }
                });
            }
            else {
                resolve();
            }
        });
    }
    async disconnectSession(tenantId) {
        try {
            const session = this.sessions.get(tenantId);
            if (!session) {
                return { success: true, message: 'Session not found' };
            }
            if (session.socket) {
                try {
                    await session.socket.logout();
                }
                catch (error) {
                    console.log(error, 'Error during logout');
                }
            }
            const timer = this.reconnectTimers.get(tenantId);
            if (timer) {
                clearTimeout(timer);
                this.reconnectTimers.delete(tenantId);
            }
            await this.clearSessionData(tenantId);
            this.cleanupSession(tenantId);
            console.log({ tenantId }, 'Session disconnected successfully');
            return { success: true, message: 'Session disconnected' };
        }
        catch (error) {
            console.log(error, 'Failed to disconnect session');
            const err = error;
            return { success: false, message: err.message };
        }
    }
    async clearSessionData(tenantId) {
        try {
            const sessionPath = path.join(this.sessionDir, tenantId);
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log({ tenantId, path: sessionPath }, 'Session data cleared');
            }
        }
        catch (error) {
            console.log(error, 'Failed to clear session data');
        }
    }
    cleanupSession(tenantId) {
        this.sessions.delete(tenantId);
        this.cache.del(`qr_${tenantId}`);
    }
    async disconnectAllSessions() {
        const tenants = Array.from(this.sessions.keys());
        console.log({ count: tenants.length }, 'Disconnecting all sessions');
        const promises = tenants.map(tenantId => this.disconnectSession(tenantId));
        await Promise.allSettled(promises);
        console.log('All sessions disconnected');
    }
    getActiveSessions() {
        return Array.from(this.sessions.entries()).map(([tenantId, session]) => ({
            tenantId,
            status: session.status,
            phoneNumber: session.phoneNumber || undefined,
            lastActivity: session.lastActivity.toISOString()
        }));
    }
}
exports.WhatsAppService = WhatsAppService;
