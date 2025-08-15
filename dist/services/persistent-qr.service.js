"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistentQRService = void 0;
class PersistentQRService {
    constructor(logger, whatsappService) {
        this.logger = logger;
        this.whatsappService = whatsappService;
        this.qrSessions = new Map();
        this.regenerationIntervals = new Map();
        this.QR_LIFETIME = 45000;
        this.MAX_REGENERATIONS = 10;
        this.REGENERATION_INTERVAL = 30000;
        console.log('🔄 [PersistentQR] Service initialized');
        setInterval(() => this.cleanExpiredSessions(), 5 * 60 * 1000);
    }
    async startPersistentQR(tenantId) {
        try {
            console.log(`🚀 [PersistentQR] Starting persistent QR management for tenant ${tenantId.substring(0, 8)}***`);
            const session = {
                tenantId,
                qrCode: null,
                lastGenerated: Date.now(),
                regenerationCount: 0,
                status: 'generating',
                connectionAttempts: 0
            };
            this.qrSessions.set(tenantId, session);
            const initialQR = await this.generateQRCode(tenantId);
            if (initialQR) {
                session.qrCode = initialQR;
                session.status = 'available';
                session.lastGenerated = Date.now();
                this.startRegenerationCycle(tenantId);
                console.log(`✅ [PersistentQR] Initial QR generated successfully for tenant ${tenantId.substring(0, 8)}*** (length: ${initialQR.length})`);
                return initialQR;
            }
            console.log('⚠️ [PersistentQR] Failed to generate initial QR');
            return null;
        }
        catch (error) {
            console.log(`❌ [PersistentQR] Failed to start persistent QR for tenant ${tenantId.substring(0, 8)}***: ${error.message}`);
            return null;
        }
    }
    getCurrentQR(tenantId) {
        const session = this.qrSessions.get(tenantId);
        if (!session) {
            console.log(`⚠️ [PersistentQR] No session found for tenant ${tenantId.substring(0, 8)}***`);
            return null;
        }
        const age = Date.now() - session.lastGenerated;
        if (age > this.QR_LIFETIME && session.status !== 'connected') {
            console.log(`🔄 [PersistentQR] QR expired for tenant ${tenantId.substring(0, 8)}***, age: ${Math.round(age / 1000)}s, status: ${session.status}`);
            this.regenerateQR(tenantId);
        }
        return session.qrCode;
    }
    markAsConnected(tenantId) {
        const session = this.qrSessions.get(tenantId);
        if (session) {
            session.status = 'connected';
            session.qrCode = null;
            this.stopRegenerationCycle(tenantId);
            console.log(`✅ [PersistentQR] Session marked as connected for tenant ${tenantId.substring(0, 8)}*** (regenerations: ${session.regenerationCount})`);
        }
    }
    startRegenerationCycle(tenantId) {
        this.stopRegenerationCycle(tenantId);
        const interval = setInterval(async () => {
            const session = this.qrSessions.get(tenantId);
            if (!session || session.status === 'connected') {
                this.stopRegenerationCycle(tenantId);
                return;
            }
            const age = Date.now() - session.lastGenerated;
            const shouldRegenerate = age > this.QR_LIFETIME && session.regenerationCount < this.MAX_REGENERATIONS;
            if (shouldRegenerate) {
                await this.regenerateQR(tenantId);
            }
            else if (session.regenerationCount >= this.MAX_REGENERATIONS) {
                console.log(`⚠️ [PersistentQR] Max regenerations reached for tenant ${tenantId.substring(0, 8)}***, stopping cycle (count: ${session.regenerationCount})`);
                this.stopRegenerationCycle(tenantId);
            }
        }, this.REGENERATION_INTERVAL);
        this.regenerationIntervals.set(tenantId, interval);
        console.log(`🔄 [PersistentQR] Regeneration cycle started for tenant ${tenantId.substring(0, 8)}*** (interval: ${this.REGENERATION_INTERVAL / 1000}s)`);
    }
    stopRegenerationCycle(tenantId) {
        const interval = this.regenerationIntervals.get(tenantId);
        if (interval) {
            clearInterval(interval);
            this.regenerationIntervals.delete(tenantId);
            console.log(`⏹️ [PersistentQR] Regeneration cycle stopped for tenant ${tenantId.substring(0, 8)}***`);
        }
    }
    async regenerateQR(tenantId) {
        const session = this.qrSessions.get(tenantId);
        if (!session || session.status === 'connected') {
            return;
        }
        if (session.regenerationCount >= this.MAX_REGENERATIONS) {
            console.log(`⚠️ [PersistentQR] Max regenerations reached for tenant ${tenantId.substring(0, 8)}***, skipping`);
            return;
        }
        try {
            session.status = 'generating';
            console.log(`🔄 [PersistentQR] Starting QR regeneration for tenant ${tenantId.substring(0, 8)}*** (attempt ${session.regenerationCount + 1}/${this.MAX_REGENERATIONS})`);
            const newQR = await this.generateQRCode(tenantId);
            if (newQR) {
                session.qrCode = newQR;
                session.lastGenerated = Date.now();
                session.regenerationCount++;
                session.status = 'available';
                console.log(`✅ [PersistentQR] QR regenerated successfully for tenant ${tenantId.substring(0, 8)}*** (count: ${session.regenerationCount}, length: ${newQR.length})`);
            }
            else {
                session.status = 'expired';
                console.log('❌ [PersistentQR] QR regeneration failed');
            }
        }
        catch (error) {
            session.status = 'expired';
            console.log(`❌ [PersistentQR] QR regeneration error for tenant ${tenantId.substring(0, 8)}***: ${error.message}`);
        }
    }
    async generateQRCode(tenantId) {
        try {
            await this.waitForSessionReady(tenantId, 30000);
            const result = await this.whatsappService.getSessionQR(tenantId);
            return result?.qrCode || null;
        }
        catch (error) {
            console.log(`❌ [PersistentQR] QR generation via WhatsApp service failed for tenant ${tenantId.substring(0, 8)}***: ${error.message}`);
            return null;
        }
    }
    async waitForSessionReady(tenantId, maxWait = 30000) {
        const startTime = Date.now();
        const pollInterval = 1000;
        while (Date.now() - startTime < maxWait) {
            try {
                const status = await this.whatsappService.getSessionStatus(tenantId);
                if (status && (status.status === 'qr' || status.qrCode)) {
                    console.log(`✅ [PersistentQR] Session ready for QR generation for tenant ${tenantId.substring(0, 8)}*** (wait: ${Date.now() - startTime}ms)`);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
            catch (error) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }
        console.log(`⏰ [PersistentQR] Session ready timeout reached for tenant ${tenantId.substring(0, 8)}*** (maxWait: ${maxWait}ms)`);
        throw new Error('Session not ready within timeout');
    }
    cleanExpiredSessions() {
        const now = Date.now();
        const expiredSessions = [];
        for (const [tenantId, session] of this.qrSessions.entries()) {
            const age = now - session.lastGenerated;
            const isExpired = age > (this.QR_LIFETIME * 3) && session.status !== 'connected';
            if (isExpired) {
                expiredSessions.push(tenantId);
            }
        }
        for (const tenantId of expiredSessions) {
            this.stopPersistentQR(tenantId);
        }
        if (expiredSessions.length > 0) {
            console.log(`🧹 [PersistentQR] Cleaned ${expiredSessions.length} expired sessions`);
        }
    }
    stopPersistentQR(tenantId) {
        this.stopRegenerationCycle(tenantId);
        this.qrSessions.delete(tenantId);
        console.log(`⏹️ [PersistentQR] Persistent QR stopped for tenant ${tenantId.substring(0, 8)}***`);
    }
    getSessionStats(tenantId) {
        const session = this.qrSessions.get(tenantId);
        if (!session) {
            return null;
        }
        return {
            status: session.status,
            regenerationCount: session.regenerationCount,
            lastGenerated: session.lastGenerated,
            age: Date.now() - session.lastGenerated,
            hasQR: !!session.qrCode,
            connectionAttempts: session.connectionAttempts
        };
    }
    getActiveSessionsCount() {
        return this.qrSessions.size;
    }
}
exports.PersistentQRService = PersistentQRService;
