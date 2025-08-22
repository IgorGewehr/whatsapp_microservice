import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config';

export interface AuthenticatedRequest extends Request {
  tenantId?: string;
  permissions?: string[];
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Pular autenticação em desenvolvimento se configurado
  if (!config.REQUIRE_AUTH && config.IS_DEVELOPMENT) {
    req.tenantId = 'default';
    req.permissions = ['*'];
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : null;

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Bearer token missing in Authorization header',
      timestamp: new Date().toISOString()
    });
    return;
  }

  try {
    // Verificar se é API key
    if (token === config.API_KEY) {
      // API key válida - acesso total
      req.tenantId = req.headers['x-tenant-id'] as string || 'default';
      req.permissions = ['*'];
      return next();
    }

    // Verificar Firebase ID Token
    if (token.includes('.')) {
      // Token JWT format - assumir que é Firebase ID Token
      // Para simplificar, extrair uid do token sem verificação completa (temporário)
      try {
        const decoded = jwt.decode(token) as any;
        if (decoded && decoded.sub && decoded.firebase) {
          req.tenantId = decoded.sub; // Firebase UID como tenant ID
          req.permissions = ['*'];
          return next();
        }
      } catch {
        // Continuar para verificação como JWT personalizado
      }
    }

    // Tentar verificar como JWT personalizado (fallback)
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    
    if (decoded.type === 'tenant_access' && decoded.tenantId) {
      req.tenantId = decoded.tenantId;
      req.permissions = decoded.permissions || [];
      return next();
    }

    // Token inválido
    res.status(401).json({
      success: false,
      error: 'Invalid token',
      message: 'Token is not valid or expired',
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Authentication token has expired',
        timestamp: new Date().toISOString()
      });
    } else if (err.name === 'JsonWebTokenError') {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'Authentication token is malformed',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Authentication error',
        message: 'Failed to verify authentication token',
        timestamp: new Date().toISOString()
      });
    }
  }
}