"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantManager = void 0;
const node_cache_1 = __importDefault(require("node-cache"));
const config_1 = require("../config/config");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
class TenantManager {
    constructor(logger) {
        this.tenants = new Map();
        this.tenantAuth = new Map();
        this.logger = logger.child({ service: 'TenantManager' });
        this.cache = new node_cache_1.default({
            stdTTL: config_1.config.CACHE_TTL * 2,
            checkperiod: 120,
            useClones: false
        });
        this.initializeDefaultTenants();
        console.log('Tenant Manager initialized');
    }
    initializeDefaultTenants() {
        const defaultTenant = {
            id: 'default',
            name: 'Default Tenant',
            settings: {
                maxSessions: 10,
                rateLimit: {
                    windowMs: 15 * 60 * 1000,
                    max: 100
                }
            },
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.tenants.set('default', defaultTenant);
        this.cache.set(`tenant_default`, defaultTenant);
        const defaultAuth = {
            tenantId: 'default',
            permissions: ['*'],
        };
        this.tenantAuth.set('default', defaultAuth);
        console.log('Default tenant initialized', { tenantId: 'default' });
    }
    async createTenant(tenantData) {
        try {
            const tenant = {
                ...tenantData,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await this.validateTenantData(tenant);
            if (this.tenants.has(tenant.id)) {
                throw new Error(`Tenant ${tenant.id} already exists`);
            }
            this.tenants.set(tenant.id, tenant);
            this.cache.set(`tenant_${tenant.id}`, tenant);
            console.log('Tenant created successfully', {
                tenantId: tenant.id,
                name: tenant.name
            });
            return tenant;
        }
        catch (error) {
            console.log('Failed to create tenant:', error);
            throw error;
        }
    }
    async getTenant(tenantId) {
        try {
            let tenant = this.cache.get(`tenant_${tenantId}`);
            if (!tenant) {
                tenant = this.tenants.get(tenantId) || null;
                if (tenant) {
                    this.cache.set(`tenant_${tenantId}`, tenant);
                }
            }
            if (tenant) {
                tenant.lastActivity = new Date();
                this.tenants.set(tenantId, tenant);
            }
            return tenant;
        }
        catch (error) {
            console.log('Failed to get tenant:', error);
            return null;
        }
    }
    async updateTenant(tenantId, updates) {
        try {
            const existingTenant = await this.getTenant(tenantId);
            if (!existingTenant) {
                throw new Error(`Tenant ${tenantId} not found`);
            }
            const updatedTenant = {
                ...existingTenant,
                ...updates,
                id: tenantId,
                updatedAt: new Date()
            };
            await this.validateTenantData(updatedTenant);
            this.tenants.set(tenantId, updatedTenant);
            this.cache.set(`tenant_${tenantId}`, updatedTenant);
            console.log('Tenant updated successfully', {
                tenantId,
                updates: Object.keys(updates)
            });
            return updatedTenant;
        }
        catch (error) {
            console.log('Failed to update tenant:', error);
            throw error;
        }
    }
    async deleteTenant(tenantId) {
        try {
            if (!this.tenants.has(tenantId)) {
                return false;
            }
            if (tenantId === 'default') {
                throw new Error('Cannot delete default tenant');
            }
            this.tenants.delete(tenantId);
            this.tenantAuth.delete(tenantId);
            this.cache.del(`tenant_${tenantId}`);
            this.cache.del(`auth_${tenantId}`);
            console.log('Tenant deleted successfully', { tenantId });
            return true;
        }
        catch (error) {
            console.log('Failed to delete tenant:', error);
            throw error;
        }
    }
    async validateTenantAccess(tenantId, requiredPermissions = []) {
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
        }
        catch (error) {
            console.log('Failed to validate tenant access:', error);
            return false;
        }
    }
    async createTenantAuth(tenantId, options = {}) {
        try {
            const tenant = await this.getTenant(tenantId);
            if (!tenant) {
                throw new Error(`Tenant ${tenantId} not found`);
            }
            const auth = {
                tenantId,
                permissions: options.permissions || ['read', 'write'],
                apiKey: options.apiKey,
            };
            if (!options.apiKey) {
                const jwtPayload = {
                    tenantId,
                    permissions: auth.permissions,
                    type: 'tenant_access'
                };
                const jwtOptions = {};
                if (options.expiresIn) {
                    jwtOptions.expiresIn = options.expiresIn;
                    const now = new Date();
                    if (typeof options.expiresIn === 'string') {
                        const match = options.expiresIn.match(/^(\d+)([smhdy])$/);
                        if (match) {
                            const value = parseInt(match[1]);
                            const unit = match[2];
                            const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, y: 31536000000 };
                            const duration = value * (multipliers[unit] || 86400000);
                            auth.expiresAt = new Date(now.getTime() + duration);
                        }
                    }
                    else if (typeof options.expiresIn === 'number') {
                        auth.expiresAt = new Date(now.getTime() + options.expiresIn * 1000);
                    }
                }
                auth.jwtToken = jsonwebtoken_1.default.sign(jwtPayload, config_1.config.JWT_SECRET, jwtOptions);
            }
            this.tenantAuth.set(tenantId, auth);
            this.cache.set(`auth_${tenantId}`, auth, options.expiresIn ? undefined : config_1.config.CACHE_TTL);
            console.log('Tenant auth created successfully', {
                tenantId,
                hasApiKey: !!auth.apiKey,
                hasJwtToken: !!auth.jwtToken,
                permissions: auth.permissions
            });
            return auth;
        }
        catch (error) {
            console.log('Failed to create tenant auth:', error);
            throw error;
        }
    }
    async validateTenantAuth(tenantId, token) {
        try {
            const auth = this.tenantAuth.get(tenantId);
            if (!auth) {
                return null;
            }
            if (auth.expiresAt && auth.expiresAt < new Date()) {
                console.log('Tenant auth expired', { tenantId });
                this.tenantAuth.delete(tenantId);
                return null;
            }
            if (auth.apiKey && auth.apiKey === token) {
                return auth;
            }
            if (auth.jwtToken) {
                try {
                    const decoded = jsonwebtoken_1.default.verify(token, config_1.config.JWT_SECRET);
                    if (decoded.tenantId === tenantId && decoded.type === 'tenant_access') {
                        return auth;
                    }
                }
                catch (jwtError) {
                    console.log('Invalid JWT token', { tenantId, error: jwtError.message });
                }
            }
            return null;
        }
        catch (error) {
            console.log('Failed to validate tenant auth:', error);
            return null;
        }
    }
    checkPermissions(available, required) {
        if (available.includes('*')) {
            return true;
        }
        return required.every(perm => available.includes(perm));
    }
    async validateTenantData(tenant) {
        if (!tenant.id || typeof tenant.id !== 'string' || tenant.id.length < 3) {
            throw new Error('Tenant ID must be a string with at least 3 characters');
        }
        if (!tenant.name || typeof tenant.name !== 'string' || tenant.name.length < 3) {
            throw new Error('Tenant name must be a string with at least 3 characters');
        }
        if (!['active', 'suspended', 'inactive'].includes(tenant.status)) {
            throw new Error('Tenant status must be active, suspended, or inactive');
        }
        if (tenant.settings.maxSessions && tenant.settings.maxSessions < 1) {
            throw new Error('Max sessions must be at least 1');
        }
        if (tenant.settings.webhookUrl && !this.isValidUrl(tenant.settings.webhookUrl)) {
            throw new Error('Webhook URL must be a valid URL');
        }
    }
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        }
        catch (_) {
            return false;
        }
    }
    getAllTenants() {
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
    getActiveTenantCount() {
        return Array.from(this.tenants.values()).filter(t => t.status === 'active').length;
    }
    async cleanupExpiredAuth() {
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
exports.TenantManager = TenantManager;
