import { Logger } from 'pino';
import NodeCache from 'node-cache';
import { config } from '../config/config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface Tenant {
  id: string;
  name: string;
  domain?: string;
  settings: {
    allowedPhoneNumbers?: string[];
    webhookUrl?: string;
    webhookSecret?: string;
    maxSessions?: number;
    rateLimit?: {
      windowMs: number;
      max: number;
    };
  };
  status: 'active' | 'suspended' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
  lastActivity?: Date;
}

export interface TenantAuth {
  tenantId: string;
  apiKey?: string;
  jwtToken?: string;
  permissions: string[];
  expiresAt?: Date;
}

export class TenantManager {
  private cache: NodeCache;
  private logger: Logger;
  private tenants: Map<string, Tenant> = new Map();
  private tenantAuth: Map<string, TenantAuth> = new Map();

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'TenantManager' });
    this.cache = new NodeCache({ 
      stdTTL: config.CACHE_TTL * 2, // Cache tenants por mais tempo
      checkperiod: 120,
      useClones: false
    });
    
    this.initializeDefaultTenants();
    console.log('Tenant Manager initialized');
  }

  private initializeDefaultTenants(): void {
    // Criar tenant padrão para desenvolvimento/testes
    const defaultTenant: Tenant = {
      id: 'default',
      name: 'Default Tenant',
      settings: {
        maxSessions: 10,
        rateLimit: {
          windowMs: 15 * 60 * 1000, // 15 minutos
          max: 100
        }
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.tenants.set('default', defaultTenant);
    this.cache.set(`tenant_default`, defaultTenant);

    // Criar auth para tenant padrão
    const defaultAuth: TenantAuth = {
      tenantId: 'default',
      permissions: ['*'], // Todas as permissões para desenvolvimento
    };

    this.tenantAuth.set('default', defaultAuth);
    
    console.log('Default tenant initialized', { tenantId: 'default' });
  }

  async createTenant(tenantData: Omit<Tenant, 'createdAt' | 'updatedAt'>): Promise<Tenant> {
    try {
      const tenant: Tenant = {
        ...tenantData,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Validar dados do tenant
      await this.validateTenantData(tenant);

      // Verificar se já existe
      if (this.tenants.has(tenant.id)) {
        throw new Error(`Tenant ${tenant.id} already exists`);
      }

      // Salvar tenant
      this.tenants.set(tenant.id, tenant);
      this.cache.set(`tenant_${tenant.id}`, tenant);

      console.log('Tenant created successfully', { 
        tenantId: tenant.id, 
        name: tenant.name 
      });

      return tenant;

    } catch (error) {
      console.log('Failed to create tenant:', error);
      throw error;
    }
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    try {
      // Buscar no cache primeiro
      let tenant = this.cache.get<Tenant>(`tenant_${tenantId}`);
      
      if (!tenant) {
        // Buscar na memória
        tenant = this.tenants.get(tenantId) || null;
        
        if (tenant) {
          // Salvar no cache
          this.cache.set(`tenant_${tenantId}`, tenant);
        }
      }

      if (tenant) {
        // Atualizar última atividade
        tenant.lastActivity = new Date();
        this.tenants.set(tenantId, tenant);
      }

      return tenant;

    } catch (error) {
      console.log('Failed to get tenant:', error);
      return null;
    }
  }

  async updateTenant(tenantId: string, updates: Partial<Tenant>): Promise<Tenant> {
    try {
      const existingTenant = await this.getTenant(tenantId);
      if (!existingTenant) {
        throw new Error(`Tenant ${tenantId} not found`);
      }

      const updatedTenant: Tenant = {
        ...existingTenant,
        ...updates,
        id: tenantId, // Não permitir alterar ID
        updatedAt: new Date()
      };

      // Validar dados atualizados
      await this.validateTenantData(updatedTenant);

      // Salvar atualizações
      this.tenants.set(tenantId, updatedTenant);
      this.cache.set(`tenant_${tenantId}`, updatedTenant);

      console.log('Tenant updated successfully', { 
        tenantId, 
        updates: Object.keys(updates) 
      });

      return updatedTenant;

    } catch (error) {
      console.log('Failed to update tenant:', error);
      throw error;
    }
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    try {
      if (!this.tenants.has(tenantId)) {
        return false;
      }

      // Não permitir deletar tenant default
      if (tenantId === 'default') {
        throw new Error('Cannot delete default tenant');
      }

      this.tenants.delete(tenantId);
      this.tenantAuth.delete(tenantId);
      this.cache.del(`tenant_${tenantId}`);
      this.cache.del(`auth_${tenantId}`);

      console.log('Tenant deleted successfully', { tenantId });
      return true;

    } catch (error) {
      console.log('Failed to delete tenant:', error);
      throw error;
    }
  }

  async validateTenantAccess(tenantId: string, requiredPermissions: string[] = []): Promise<boolean> {
    try {
      const tenant = await this.getTenant(tenantId);
      if (!tenant) {
        console.log('Tenant not found during access validation', { tenantId });
        return false;
      }

      if (tenant.status !== 'active') {
        console.log('Tenant is not active', { tenantId, status: tenant.status });
        return false;
      }

      // Verificar permissões se necessário
      if (requiredPermissions.length > 0) {
        const auth = this.tenantAuth.get(tenantId);
        if (!auth) {
          console.log('No auth found for tenant', { tenantId });
          return false;
        }

        const hasPermissions = this.checkPermissions(auth.permissions, requiredPermissions);
        if (!hasPermissions) {
          console.log('Tenant lacks required permissions', { 
            tenantId, 
            required: requiredPermissions,
            available: auth.permissions 
          });
          return false;
        }
      }

      return true;

    } catch (error) {
      console.log('Failed to validate tenant access:', error);
      return false;
    }
  }

  async createTenantAuth(tenantId: string, options: {
    apiKey?: string;
    permissions?: string[];
    expiresIn?: string | number;
  } = {}): Promise<TenantAuth> {
    try {
      const tenant = await this.getTenant(tenantId);
      if (!tenant) {
        throw new Error(`Tenant ${tenantId} not found`);
      }

      const auth: TenantAuth = {
        tenantId,
        permissions: options.permissions || ['read', 'write'],
        apiKey: options.apiKey,
      };

      // Gerar JWT token se necessário
      if (!options.apiKey) {
        const jwtPayload = {
          tenantId,
          permissions: auth.permissions,
          type: 'tenant_access'
        };

        const jwtOptions: any = {};
        if (options.expiresIn) {
          jwtOptions.expiresIn = options.expiresIn;
          // Calcular data de expiração
          const now = new Date();
          if (typeof options.expiresIn === 'string') {
            // Exemplo: '7d', '24h', '1y'
            const match = options.expiresIn.match(/^(\d+)([smhdy])$/);
            if (match) {
              const value = parseInt(match[1]);
              const unit = match[2];
              const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, y: 31536000000 };
              const duration = value * (multipliers[unit as keyof typeof multipliers] || 86400000);
              auth.expiresAt = new Date(now.getTime() + duration);
            }
          } else if (typeof options.expiresIn === 'number') {
            auth.expiresAt = new Date(now.getTime() + options.expiresIn * 1000);
          }
        }

        auth.jwtToken = jwt.sign(jwtPayload, config.JWT_SECRET, jwtOptions);
      }

      // Salvar auth
      this.tenantAuth.set(tenantId, auth);
      this.cache.set(`auth_${tenantId}`, auth, options.expiresIn ? undefined : config.CACHE_TTL);

      console.log('Tenant auth created successfully', { 
        tenantId, 
        hasApiKey: !!auth.apiKey,
        hasJwtToken: !!auth.jwtToken,
        permissions: auth.permissions 
      });

      return auth;

    } catch (error) {
      console.log('Failed to create tenant auth:', error);
      throw error;
    }
  }

  async validateTenantAuth(tenantId: string, token: string): Promise<TenantAuth | null> {
    try {
      const auth = this.tenantAuth.get(tenantId);
      if (!auth) {
        return null;
      }

      // Verificar se expirou
      if (auth.expiresAt && auth.expiresAt < new Date()) {
        console.log('Tenant auth expired', { tenantId });
        this.tenantAuth.delete(tenantId);
        return null;
      }

      // Validar token
      if (auth.apiKey && auth.apiKey === token) {
        return auth;
      }

      if (auth.jwtToken) {
        try {
          const decoded = jwt.verify(token, config.JWT_SECRET) as any;
          if (decoded.tenantId === tenantId && decoded.type === 'tenant_access') {
            return auth;
          }
        } catch (jwtError) {
          console.log('Invalid JWT token', { tenantId, error: jwtError.message });
        }
      }

      return null;

    } catch (error) {
      console.log('Failed to validate tenant auth:', error);
      return null;
    }
  }

  private checkPermissions(available: string[], required: string[]): boolean {
    if (available.includes('*')) {
      return true; // Acesso total
    }

    return required.every(perm => available.includes(perm));
  }

  private async validateTenantData(tenant: Tenant): Promise<void> {
    if (!tenant.id || typeof tenant.id !== 'string' || tenant.id.length < 3) {
      throw new Error('Tenant ID must be a string with at least 3 characters');
    }

    if (!tenant.name || typeof tenant.name !== 'string' || tenant.name.length < 3) {
      throw new Error('Tenant name must be a string with at least 3 characters');
    }

    if (!['active', 'suspended', 'inactive'].includes(tenant.status)) {
      throw new Error('Tenant status must be active, suspended, or inactive');
    }

    // Validar configurações
    if (tenant.settings.maxSessions && tenant.settings.maxSessions < 1) {
      throw new Error('Max sessions must be at least 1');
    }

    if (tenant.settings.webhookUrl && !this.isValidUrl(tenant.settings.webhookUrl)) {
      throw new Error('Webhook URL must be a valid URL');
    }
  }

  private isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  getAllTenants(): Array<Omit<Tenant, 'settings'>> {
    return Array.from(this.tenants.values()).map(tenant => ({
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain,
      status: tenant.status,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      lastActivity: tenant.lastActivity
    }));
  }

  getActiveTenantCount(): number {
    return Array.from(this.tenants.values()).filter(t => t.status === 'active').length;
  }

  async cleanupExpiredAuth(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;

    for (const [tenantId, auth] of this.tenantAuth.entries()) {
      if (auth.expiresAt && auth.expiresAt < now) {
        this.tenantAuth.delete(tenantId);
        this.cache.del(`auth_${tenantId}`);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log('Cleaned up expired auth tokens', { count: cleanedCount });
    }
  }
}