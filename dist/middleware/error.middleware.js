"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TooManyRequestsError = exports.ConflictError = exports.NotFoundError = exports.ForbiddenError = exports.UnauthorizedError = exports.ValidationError = void 0;
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
exports.createAppError = createAppError;
function errorHandler(logger) {
    return (err, req, res, next) => {
        if (res.headersSent) {
            return next(err);
        }
        logger.error({
            error: err.message,
            stack: err.stack,
            url: req.originalUrl,
            method: req.method,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            tenantId: req.tenantId
        }, 'Unhandled error');
        let statusCode = err.statusCode || 500;
        let message = err.message;
        let errorType = err.code || 'INTERNAL_ERROR';
        if (err.name === 'ValidationError') {
            statusCode = 400;
            errorType = 'VALIDATION_ERROR';
            message = 'Validation failed';
        }
        else if (err.name === 'UnauthorizedError') {
            statusCode = 401;
            errorType = 'UNAUTHORIZED';
            message = 'Authentication required';
        }
        else if (err.name === 'ForbiddenError') {
            statusCode = 403;
            errorType = 'FORBIDDEN';
            message = 'Access denied';
        }
        else if (err.name === 'NotFoundError') {
            statusCode = 404;
            errorType = 'NOT_FOUND';
            message = 'Resource not found';
        }
        else if (err.name === 'ConflictError') {
            statusCode = 409;
            errorType = 'CONFLICT';
            message = 'Resource conflict';
        }
        else if (err.name === 'TooManyRequestsError') {
            statusCode = 429;
            errorType = 'RATE_LIMIT_EXCEEDED';
            message = 'Too many requests';
        }
        const errorResponse = {
            success: false,
            error: errorType,
            message: message,
            timestamp: new Date().toISOString(),
            requestId: req.id || generateRequestId()
        };
        if (process.env.NODE_ENV === 'development') {
            errorResponse.stack = err.stack;
            errorResponse.details = {
                originalError: err.name,
                isOperational: err.isOperational,
                statusCode: err.statusCode
            };
        }
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block'
        });
        res.status(statusCode).json(errorResponse);
    };
}
function notFoundHandler(req, res, next) {
    const error = new Error(`Route ${req.originalUrl} not found`);
    error.statusCode = 404;
    error.isOperational = true;
    error.code = 'ROUTE_NOT_FOUND';
    next(error);
}
function createAppError(message, statusCode = 500, code = 'APP_ERROR', isOperational = true) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.isOperational = isOperational;
    error.code = code;
    return error;
}
class ValidationError extends Error {
    constructor(message, details) {
        super(message);
        this.details = details;
        this.statusCode = 400;
        this.isOperational = true;
        this.code = 'VALIDATION_ERROR';
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class UnauthorizedError extends Error {
    constructor(message = 'Authentication required') {
        super(message);
        this.statusCode = 401;
        this.isOperational = true;
        this.code = 'UNAUTHORIZED';
        this.name = 'UnauthorizedError';
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends Error {
    constructor(message = 'Access denied') {
        super(message);
        this.statusCode = 403;
        this.isOperational = true;
        this.code = 'FORBIDDEN';
        this.name = 'ForbiddenError';
    }
}
exports.ForbiddenError = ForbiddenError;
class NotFoundError extends Error {
    constructor(message = 'Resource not found') {
        super(message);
        this.statusCode = 404;
        this.isOperational = true;
        this.code = 'NOT_FOUND';
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
class ConflictError extends Error {
    constructor(message = 'Resource conflict') {
        super(message);
        this.statusCode = 409;
        this.isOperational = true;
        this.code = 'CONFLICT';
        this.name = 'ConflictError';
    }
}
exports.ConflictError = ConflictError;
class TooManyRequestsError extends Error {
    constructor(message = 'Too many requests') {
        super(message);
        this.statusCode = 429;
        this.isOperational = true;
        this.code = 'RATE_LIMIT_EXCEEDED';
        this.name = 'TooManyRequestsError';
    }
}
exports.TooManyRequestsError = TooManyRequestsError;
function generateRequestId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
