import { Logger } from 'pino';
import { promises as fs } from 'fs';
import os from 'os';

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    [key: string]: {
      status: 'up' | 'down' | 'degraded';
      responseTime?: number;
      lastCheck: string;
      details?: any;
    };
  };
  system: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
    disk: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

export class StatusService {
  private logger: Logger;
  private startTime: number;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'StatusService' });
    this.startTime = Date.now();
  }

  async getSystemHealth(): Promise<SystemHealth> {
    const services = await this.checkServices();
    const system = await this.getSystemMetrics();
    
    // Determinar status geral
    const serviceStatuses = Object.values(services).map(s => s.status);
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (serviceStatuses.every(s => s === 'up')) {
      overallStatus = 'healthy';
    } else if (serviceStatuses.some(s => s === 'up')) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }

    // Verificar recursos do sistema
    if (system.memory.percentage > 90 || system.disk.percentage > 95) {
      overallStatus = overallStatus === 'healthy' ? 'degraded' : 'unhealthy';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services,
      system
    };
  }

  private async checkServices(): Promise<SystemHealth['services']> {
    const services: SystemHealth['services'] = {};
    const now = new Date().toISOString();

    // Verificar dependências do Baileys
    try {
      const startTime = Date.now();
      const baileys = await import('@whiskeysockets/baileys');
      const responseTime = Date.now() - startTime;
      
      services.baileys = {
        status: baileys ? 'up' : 'down',
        responseTime,
        lastCheck: now,
        details: {
          version: baileys.version || 'unknown',
          loaded: !!baileys.default
        }
      };
    } catch (error) {
      services.baileys = {
        status: 'down',
        lastCheck: now,
        details: { error: error.message }
      };
    }

    // Verificar QRCode
    try {
      const startTime = Date.now();
      const qrcode = require('qrcode');
      const responseTime = Date.now() - startTime;
      
      services.qrcode = {
        status: qrcode && typeof qrcode.toDataURL === 'function' ? 'up' : 'down',
        responseTime,
        lastCheck: now,
        details: {
          hasToDataURL: typeof qrcode.toDataURL === 'function'
        }
      };
    } catch (error) {
      services.qrcode = {
        status: 'down',
        lastCheck: now,
        details: { error: error.message }
      };
    }

    // Verificar sistema de arquivos
    try {
      const startTime = Date.now();
      const testPath = './sessions';
      
      await fs.mkdir(testPath, { recursive: true });
      const testFile = `${testPath}/.health-check`;
      await fs.writeFile(testFile, 'health-check');
      await fs.unlink(testFile);
      
      const responseTime = Date.now() - startTime;
      
      services.filesystem = {
        status: 'up',
        responseTime,
        lastCheck: now,
        details: { path: testPath }
      };
    } catch (error) {
      services.filesystem = {
        status: 'down',
        lastCheck: now,
        details: { error: error.message }
      };
    }

    return services;
  }

  private async getSystemMetrics(): Promise<SystemHealth['system']> {
    const memInfo = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // CPU usage (simplified)
    const cpuUsage = process.cpuUsage();
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds

    // Disk usage (simplified - checking current working directory)
    let diskUsed = 0;
    let diskTotal = 0;
    
    try {
      const stats = await fs.stat(process.cwd());
      // Esta é uma estimativa simplificada - em produção você pode usar uma biblioteca específica
      diskTotal = 1000000000; // 1GB como padrão
      diskUsed = stats.size || 0;
    } catch (error) {
      // Ignorar erros de disk usage
    }

    return {
      memory: {
        used: usedMem,
        total: totalMem,
        percentage: Math.round((usedMem / totalMem) * 100)
      },
      cpu: {
        usage: Math.round(cpuPercent)
      },
      disk: {
        used: diskUsed,
        total: diskTotal,
        percentage: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0
      }
    };
  }

  async getDetailedStatus(): Promise<{
    health: SystemHealth;
    process: {
      pid: number;
      uptime: number;
      nodeVersion: string;
      platform: string;
      arch: string;
    };
    environment: {
      [key: string]: string | undefined;
    };
  }> {
    const health = await this.getSystemHealth();
    
    return {
      health,
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch()
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        HOST: process.env.HOST,
        LOG_LEVEL: process.env.LOG_LEVEL
      }
    };
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  isHealthy(): Promise<boolean> {
    return this.getSystemHealth().then(health => health.status === 'healthy');
  }
}