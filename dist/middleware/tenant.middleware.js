"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTenantAccess = validateTenantAccess;
function validateTenantAccess(tenantManager, requiredPermissions = []) {
    return async (req, res, next) => {
        try {
            const tenantId = req.params.tenantId || req.tenantId;
            if (!tenantId) {
                res.status(400).json({
                    success: false,
                    error: 'Tenant ID required',
                    message: 'Tenant ID must be provided in URL path or authenticated token',
                    timestamp: new Date().toISOString()
                });
                return;
            }
            let tenant = await tenantManager.getTenant(tenantId);
            if (!tenant) {
                try {
                    tenant = await tenantManager.createTenant({
                        id: tenantId,
                        name: `LocAI Tenant ${tenantId.substring(0, 8)}`,
                        settings: {
                            maxSessions: 5,
                            rateLimit: {
                                windowMs: 15 * 60 * 1000,
                                max: 100
                            }
                        },
                        status: 'active'
                    });
                    await tenantManager.createTenantAuth(tenantId, {
                        permissions: ['*']
                    });
                    req.log?.info('Tenant auto-created', {
                        tenantId,
                        name: tenant.name
                    });
                }
                catch (createError) {
                    req.log?.error('Failed to auto-create tenant:', createError);
                    res.status(500).json({
                        success: false,
                        error: 'Failed to create tenant',
                        message: `Could not auto-create tenant ${tenantId}`,
                        timestamp: new Date().toISOString()
                    });
                    return;
                }
            }
            const isValidAccess = await tenantManager.validateTenantAccess(tenantId, requiredPermissions);
            if (!isValidAccess) {
                if (tenant.status !== 'active') {
                    res.status(403).json({
                        success: false,
                        error: 'Tenant not active',
                        message: `Tenant ${tenantId} is ${tenant.status}`,
                        timestamp: new Date().toISOString()
                    });
                    return;
                }
                res.status(403).json({
                    success: false,
                    error: 'Insufficient permissions',
                    message: `Required permissions: ${requiredPermissions.join(', ')}`,
                    timestamp: new Date().toISOString()
                });
                return;
            }
            if (req.tenantId && req.tenantId !== tenantId && req.tenantId !== 'default') {
                res.status(403).json({
                    success: false,
                    error: 'Tenant mismatch',
                    message: 'Token tenant ID does not match URL tenant ID',
                    timestamp: new Date().toISOString()
                });
                return;
            }
            req.tenantId = tenantId;
            next();
        }
        catch (error) {
            req.log?.error('Tenant validation error:', error);
            res.status(500).json({
                success: false,
                error: 'Tenant validation failed',
                message: 'Internal error during tenant validation',
                timestamp: new Date().toISOString()
            });
        }
    };
}
