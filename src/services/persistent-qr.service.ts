import { Logger } from 'pino';
import { WhatsAppService } from './whatsapp.service';

interface QRSession {
  tenantId: string;
  qrCode: string | null;
  lastGenerated: number;
  regenerationCount: number;
  status: 'generating' | 'available' | 'expired' | 'connected';
  connectionAttempts: number;
}

/**
 * OPTIMIZED: Persistent QR Code Management Service
 * Maintains QR codes alive with intelligent regeneration
 */
export class PersistentQRService {
  private qrSessions = new Map<string, QRSession>();
  private regenerationIntervals = new Map<string, NodeJS.Timeout>();
  private readonly QR_LIFETIME = 45000; // 45 seconds
  private readonly MAX_REGENERATIONS = 10; // Maximum regenerations per session
  private readonly REGENERATION_INTERVAL = 30000; // Check every 30s

  constructor(
    private logger: Logger,
    private whatsappService: WhatsAppService
  ) {
    console.log('🔄 [PersistentQR] Service initialized');
    
    // Clean expired sessions every 5 minutes
    setInterval(() => this.cleanExpiredSessions(), 5 * 60 * 1000);
  }

  /**
   * Start persistent QR management for a tenant
   */
  async startPersistentQR(tenantId: string): Promise<string | null> {
    try {
      console.log(`🚀 [PersistentQR] Starting persistent QR management for tenant ${tenantId.substring(0, 8)}***`);

      // Initialize session tracking
      const session: QRSession = {
        tenantId,
        qrCode: null,
        lastGenerated: Date.now(),
        regenerationCount: 0,
        status: 'generating',
        connectionAttempts: 0
      };

      this.qrSessions.set(tenantId, session);

      // Generate initial QR
      const initialQR = await this.generateQRCode(tenantId);
      
      if (initialQR) {
        session.qrCode = initialQR;
        session.status = 'available';
        session.lastGenerated = Date.now();
        
        // Start regeneration cycle
        this.startRegenerationCycle(tenantId);
        
        console.log(`✅ [PersistentQR] Initial QR generated successfully for tenant ${tenantId.substring(0, 8)}*** (length: ${initialQR.length})`);
        
        return initialQR;
      }

      console.log('⚠️ [PersistentQR] Failed to generate initial QR');
      return null;

    } catch (error) {
      console.log(`❌ [PersistentQR] Failed to start persistent QR for tenant ${tenantId.substring(0, 8)}***: ${error.message}`);
      return null;
    }
  }

  /**
   * Get current QR code for tenant
   */
  getCurrentQR(tenantId: string): string | null {
    const session = this.qrSessions.get(tenantId);
    
    if (!session) {
      console.log(`⚠️ [PersistentQR] No session found for tenant ${tenantId.substring(0, 8)}***`);
      return null;
    }

    // Check if QR is still valid
    const age = Date.now() - session.lastGenerated;
    if (age > this.QR_LIFETIME && session.status !== 'connected') {
      console.log(`🔄 [PersistentQR] QR expired for tenant ${tenantId.substring(0, 8)}***, age: ${Math.round(age/1000)}s, status: ${session.status}`);
      
      // Trigger immediate regeneration
      this.regenerateQR(tenantId);
    }

    return session.qrCode;
  }

  /**
   * Mark session as connected and stop regeneration
   */
  markAsConnected(tenantId: string): void {
    const session = this.qrSessions.get(tenantId);
    
    if (session) {
      session.status = 'connected';
      session.qrCode = null; // Clear QR as it's no longer needed
      
      // Stop regeneration cycle
      this.stopRegenerationCycle(tenantId);
      
      console.log(`✅ [PersistentQR] Session marked as connected for tenant ${tenantId.substring(0, 8)}*** (regenerations: ${session.regenerationCount})`);
    }
  }

  /**
   * Start automatic QR regeneration cycle
   */
  private startRegenerationCycle(tenantId: string): void {
    // Clear existing interval if any
    this.stopRegenerationCycle(tenantId);
    
    const interval = setInterval(async () => {
      const session = this.qrSessions.get(tenantId);
      
      if (!session || session.status === 'connected') {
        this.stopRegenerationCycle(tenantId);
        return;
      }

      // Check if regeneration is needed
      const age = Date.now() - session.lastGenerated;
      const shouldRegenerate = age > this.QR_LIFETIME && session.regenerationCount < this.MAX_REGENERATIONS;
      
      if (shouldRegenerate) {
        await this.regenerateQR(tenantId);
      } else if (session.regenerationCount >= this.MAX_REGENERATIONS) {
        console.log(`⚠️ [PersistentQR] Max regenerations reached for tenant ${tenantId.substring(0, 8)}***, stopping cycle (count: ${session.regenerationCount})`);
        this.stopRegenerationCycle(tenantId);
      }
      
    }, this.REGENERATION_INTERVAL);
    
    this.regenerationIntervals.set(tenantId, interval);
    
    console.log(`🔄 [PersistentQR] Regeneration cycle started for tenant ${tenantId.substring(0, 8)}*** (interval: ${this.REGENERATION_INTERVAL/1000}s)`);
  }

  /**
   * Stop regeneration cycle for tenant
   */
  private stopRegenerationCycle(tenantId: string): void {
    const interval = this.regenerationIntervals.get(tenantId);
    
    if (interval) {
      clearInterval(interval);
      this.regenerationIntervals.delete(tenantId);
      
      console.log(`⏹️ [PersistentQR] Regeneration cycle stopped for tenant ${tenantId.substring(0, 8)}***`);
    }
  }

  /**
   * Regenerate QR code for tenant
   */
  private async regenerateQR(tenantId: string): Promise<void> {
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
      } else {
        session.status = 'expired';
        console.log('❌ [PersistentQR] QR regeneration failed');
      }

    } catch (error) {
      session.status = 'expired';
      console.log(`❌ [PersistentQR] QR regeneration error for tenant ${tenantId.substring(0, 8)}***: ${error.message}`);
    }
  }

  /**
   * FIXED: Generate QR code via WhatsApp service with retry logic
   */
  private async generateQRCode(tenantId: string): Promise<string | null> {
    try {
      // Wait for Baileys to be ready before attempting QR generation
      await this.waitForSessionReady(tenantId, 30000); // Wait up to 30s
      
      // Use WhatsApp service to generate QR
      const result = await this.whatsappService.getSessionQR(tenantId);
      return result?.qrCode || null;
    } catch (error) {
      console.log(`❌ [PersistentQR] QR generation via WhatsApp service failed for tenant ${tenantId.substring(0, 8)}***: ${error.message}`);
      return null;
    }
  }

  /**
   * FIXED: Wait for session to be ready before QR generation
   */
  private async waitForSessionReady(tenantId: string, maxWait: number = 30000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 1000; // Check every 1s
    
    while (Date.now() - startTime < maxWait) {
      try {
        const status = await this.whatsappService.getSessionStatus(tenantId);
        
        // Session is ready if it has any status (even if no QR yet)
        if (status && (status.status === 'qr' || status.qrCode)) {
          console.log(`✅ [PersistentQR] Session ready for QR generation for tenant ${tenantId.substring(0, 8)}*** (wait: ${Date.now() - startTime}ms)`);
          return;
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        // Session not ready yet, continue waiting
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    console.log(`⏰ [PersistentQR] Session ready timeout reached for tenant ${tenantId.substring(0, 8)}*** (maxWait: ${maxWait}ms)`);
    
    throw new Error('Session not ready within timeout');
  }

  /**
   * Clean expired sessions
   */
  private cleanExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];
    
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

  /**
   * Stop persistent QR for tenant
   */
  stopPersistentQR(tenantId: string): void {
    this.stopRegenerationCycle(tenantId);
    this.qrSessions.delete(tenantId);
    
    console.log(`⏹️ [PersistentQR] Persistent QR stopped for tenant ${tenantId.substring(0, 8)}***`);
  }

  /**
   * Get session statistics
   */
  getSessionStats(tenantId: string): any {
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

  /**
   * Get all active sessions count
   */
  getActiveSessionsCount(): number {
    return this.qrSessions.size;
  }
}