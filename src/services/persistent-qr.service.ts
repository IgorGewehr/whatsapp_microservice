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
    this.logger.info('🔄 [PersistentQR] Service initialized');
    
    // Clean expired sessions every 5 minutes
    setInterval(() => this.cleanExpiredSessions(), 5 * 60 * 1000);
  }

  /**
   * Start persistent QR management for a tenant
   */
  async startPersistentQR(tenantId: string): Promise<string | null> {
    try {
      this.logger.info('🚀 [PersistentQR] Starting persistent QR management', {
        tenantId: tenantId.substring(0, 8) + '***'
      });

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
        
        this.logger.info('✅ [PersistentQR] Initial QR generated successfully', {
          tenantId: tenantId.substring(0, 8) + '***',
          qrLength: initialQR.length
        });
        
        return initialQR;
      }

      this.logger.warn('⚠️ [PersistentQR] Failed to generate initial QR');
      return null;

    } catch (error) {
      this.logger.error('❌ [PersistentQR] Failed to start persistent QR', {
        tenantId: tenantId.substring(0, 8) + '***',
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get current QR code for tenant
   */
  getCurrentQR(tenantId: string): string | null {
    const session = this.qrSessions.get(tenantId);
    
    if (!session) {
      this.logger.warn('⚠️ [PersistentQR] No session found for tenant', {
        tenantId: tenantId.substring(0, 8) + '***'
      });
      return null;
    }

    // Check if QR is still valid
    const age = Date.now() - session.lastGenerated;
    if (age > this.QR_LIFETIME && session.status !== 'connected') {
      this.logger.info('🔄 [PersistentQR] QR expired, triggering regeneration', {
        tenantId: tenantId.substring(0, 8) + '***',
        age: `${Math.round(age/1000)}s`,
        status: session.status
      });
      
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
      
      this.logger.info('✅ [PersistentQR] Session marked as connected', {
        tenantId: tenantId.substring(0, 8) + '***',
        totalRegenerations: session.regenerationCount
      });
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
        this.logger.warn('⚠️ [PersistentQR] Max regenerations reached, stopping cycle', {
          tenantId: tenantId.substring(0, 8) + '***',
          regenerationCount: session.regenerationCount
        });
        this.stopRegenerationCycle(tenantId);
      }
      
    }, this.REGENERATION_INTERVAL);
    
    this.regenerationIntervals.set(tenantId, interval);
    
    this.logger.info('🔄 [PersistentQR] Regeneration cycle started', {
      tenantId: tenantId.substring(0, 8) + '***',
      interval: `${this.REGENERATION_INTERVAL/1000}s`
    });
  }

  /**
   * Stop regeneration cycle for tenant
   */
  private stopRegenerationCycle(tenantId: string): void {
    const interval = this.regenerationIntervals.get(tenantId);
    
    if (interval) {
      clearInterval(interval);
      this.regenerationIntervals.delete(tenantId);
      
      this.logger.info('⏹️ [PersistentQR] Regeneration cycle stopped', {
        tenantId: tenantId.substring(0, 8) + '***'
      });
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
      this.logger.warn('⚠️ [PersistentQR] Max regenerations reached, skipping', {
        tenantId: tenantId.substring(0, 8) + '***'
      });
      return;
    }

    try {
      session.status = 'generating';
      
      this.logger.info('🔄 [PersistentQR] Starting QR regeneration', {
        tenantId: tenantId.substring(0, 8) + '***',
        attempt: session.regenerationCount + 1,
        maxAttempts: this.MAX_REGENERATIONS
      });

      const newQR = await this.generateQRCode(tenantId);
      
      if (newQR) {
        session.qrCode = newQR;
        session.lastGenerated = Date.now();
        session.regenerationCount++;
        session.status = 'available';
        
        this.logger.info('✅ [PersistentQR] QR regenerated successfully', {
          tenantId: tenantId.substring(0, 8) + '***',
          regenerationCount: session.regenerationCount,
          qrLength: newQR.length
        });
      } else {
        session.status = 'expired';
        this.logger.error('❌ [PersistentQR] QR regeneration failed');
      }

    } catch (error) {
      session.status = 'expired';
      this.logger.error('❌ [PersistentQR] QR regeneration error', {
        tenantId: tenantId.substring(0, 8) + '***',
        error: error.message
      });
    }
  }

  /**
   * Generate QR code via WhatsApp service
   */
  private async generateQRCode(tenantId: string): Promise<string | null> {
    try {
      // Use WhatsApp service to generate QR
      const result = await this.whatsappService.getSessionQR(tenantId);
      return result?.qrCode || null;
    } catch (error) {
      this.logger.error('❌ [PersistentQR] QR generation via WhatsApp service failed', {
        tenantId: tenantId.substring(0, 8) + '***',
        error: error.message
      });
      return null;
    }
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
      this.logger.info('🧹 [PersistentQR] Cleaned expired sessions', {
        count: expiredSessions.length,
        sessions: expiredSessions.map(id => id.substring(0, 8) + '***')
      });
    }
  }

  /**
   * Stop persistent QR for tenant
   */
  stopPersistentQR(tenantId: string): void {
    this.stopRegenerationCycle(tenantId);
    this.qrSessions.delete(tenantId);
    
    this.logger.info('⏹️ [PersistentQR] Persistent QR stopped', {
      tenantId: tenantId.substring(0, 8) + '***'
    });
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