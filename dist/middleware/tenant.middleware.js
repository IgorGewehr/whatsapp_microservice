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
            const isValidAccess = await tenantManager.validateTenantAccess(tenantId, requiredPermissions);
            if (!isValidAccess) {
                const tenant = await tenantManager.getTenant(tenantId);
                if (!tenant) {
                    res.status(404).json({
                        success: false,
                        error: 'Tenant not found',
                        message: `Tenant ${tenantId} does not exist`,
                        timestamp: new Date().toISOString()
                    });
                    return;
                }
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
