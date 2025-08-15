"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config/config");
function authMiddleware(req, res, next) {
    if (!config_1.config.REQUIRE_AUTH && config_1.config.IS_DEVELOPMENT) {
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
        if (token === config_1.config.API_KEY) {
            req.tenantId = req.headers['x-tenant-id'] || 'default';
            req.permissions = ['*'];
            return next();
        }
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.JWT_SECRET);
        if (decoded.type === 'tenant_access' && decoded.tenantId) {
            req.tenantId = decoded.tenantId;
            req.permissions = decoded.permissions || [];
            return next();
        }
        res.status(401).json({
            success: false,
            error: 'Invalid token',
            message: 'Token is not valid or expired',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        const err = error;
        if (err.name === 'TokenExpiredError') {
            res.status(401).json({
                success: false,
                error: 'Token expired',
                message: 'Authentication token has expired',
                timestamp: new Date().toISOString()
            });
        }
        else if (err.name === 'JsonWebTokenError') {
            res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: 'Authentication token is malformed',
                timestamp: new Date().toISOString()
            });
        }
        else {
            res.status(500).json({
                success: false,
                error: 'Authentication error',
                message: 'Failed to verify authentication token',
                timestamp: new Date().toISOString()
            });
        }
    }
}
