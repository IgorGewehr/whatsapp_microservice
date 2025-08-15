import { Request, Response, NextFunction } from 'express';
import { TenantManager } from '../services/tenant.service';
import { AuthenticatedRequest } from './auth.middleware';

export function validateTenantAccess(tenantManager: TenantManager, requiredPermissions: string[] = []) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
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

      // Verificar se o tenant existe, criar automaticamente se não existir
      let tenant = await tenantManager.getTenant(tenantId);
      
      if (!tenant) {
        // Auto-criar tenant para compatibilidade com LocAI
        try {
          tenant = await tenantManager.createTenant({
            id: tenantId,
            name: `LocAI Tenant ${tenantId.substring(0, 8)}`,
            settings: {
              maxSessions: 5,
              rateLimit: {
                windowMs: 15 * 60 * 1000, // 15 minutos
                max: 100
              }
            },
            status: 'active'
          });

          // Criar auth com permissões completas
          await tenantManager.createTenantAuth(tenantId, {
            permissions: ['*'] // Todas as permissões
          });

          req.log?.info('Tenant auto-created', { 
            tenantId, 
            name: tenant.name 
          });

        } catch (createError) {
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

      // Verificar se o tenant existe e está ativo
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

        // Se chegou aqui, é problema de permissões
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          message: `Required permissions: ${requiredPermissions.join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Verificar se o tenant no token bate com o da URL (se ambos existirem)
      if (req.tenantId && req.tenantId !== tenantId && req.tenantId !== 'default') {
        res.status(403).json({
          success: false,
          error: 'Tenant mismatch',
          message: 'Token tenant ID does not match URL tenant ID',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Adicionar tenant ID na requisição para uso posterior
      req.tenantId = tenantId;
      
      next();

    } catch (error) {
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