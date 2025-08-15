import { Request, Response, NextFunction } from 'express';
import { Logger } from 'pino';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
}

export function errorHandler(logger: Logger) {
  return (err: AppError, req: Request, res: Response, next: NextFunction): void => {
    // Se a resposta já foi enviada, delegar para o Express
    if (res.headersSent) {
      return next(err);
    }

    // Log do erro
    (logger as any).error({
      error: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      tenantId: (req as any).tenantId
    }, 'Unhandled error');

    // Determinar status code
    let statusCode = err.statusCode || 500;
    let message = err.message;
    let errorType = err.code || 'INTERNAL_ERROR';

    // Tratar erros específicos
    if (err.name === 'ValidationError') {
      statusCode = 400;
      errorType = 'VALIDATION_ERROR';
      message = 'Validation failed';
    } else if (err.name === 'UnauthorizedError') {
      statusCode = 401;
      errorType = 'UNAUTHORIZED';
      message = 'Authentication required';
    } else if (err.name === 'ForbiddenError') {
      statusCode = 403;
      errorType = 'FORBIDDEN';
      message = 'Access denied';
    } else if (err.name === 'NotFoundError') {
      statusCode = 404;
      errorType = 'NOT_FOUND';
      message = 'Resource not found';
    } else if (err.name === 'ConflictError') {
      statusCode = 409;
      errorType = 'CONFLICT';
      message = 'Resource conflict';
    } else if (err.name === 'TooManyRequestsError') {
      statusCode = 429;
      errorType = 'RATE_LIMIT_EXCEEDED';
      message = 'Too many requests';
    }

    // Preparar resposta de erro
    const errorResponse: any = {
      success: false,
      error: errorType,
      message: message,
      timestamp: new Date().toISOString(),
      requestId: req.id || generateRequestId()
    };

    // Adicionar detalhes em desenvolvimento
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = err.stack;
      errorResponse.details = {
        originalError: err.name,
        isOperational: err.isOperational,
        statusCode: err.statusCode
      };
    }

    // Adicionar headers de segurança
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block'
    });

    // Enviar resposta
    res.status(statusCode).json(errorResponse);
  };
}

export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  const error: AppError = new Error(`Route ${req.originalUrl} not found`);
  error.statusCode = 404;
  error.isOperational = true;
  error.code = 'ROUTE_NOT_FOUND';
  
  next(error);
}

export function createAppError(
  message: string, 
  statusCode: number = 500, 
  code: string = 'APP_ERROR',
  isOperational: boolean = true
): AppError {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.isOperational = isOperational;
  error.code = code;
  return error;
}

// Classes de erro específicas
export class ValidationError extends Error {
  statusCode = 400;
  isOperational = true;
  code = 'VALIDATION_ERROR';
  
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends Error {
  statusCode = 401;
  isOperational = true;
  code = 'UNAUTHORIZED';
  
  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  isOperational = true;
  code = 'FORBIDDEN';
  
  constructor(message: string = 'Access denied') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  isOperational = true;
  code = 'NOT_FOUND';
  
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  isOperational = true;
  code = 'CONFLICT';
  
  constructor(message: string = 'Resource conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class TooManyRequestsError extends Error {
  statusCode = 429;
  isOperational = true;
  code = 'RATE_LIMIT_EXCEEDED';
  
  constructor(message: string = 'Too many requests') {
    super(message);
    this.name = 'TooManyRequestsError';
  }
}

// Utilitário para gerar request ID
function generateRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}