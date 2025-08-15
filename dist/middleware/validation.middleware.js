"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequestBody = validateRequestBody;
exports.validateRequestQuery = validateRequestQuery;
exports.validateRequestParams = validateRequestParams;
function validateRequestBody(schema) {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true,
            convert: true
        });
        if (error) {
            const errorDetails = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                type: detail.type
            }));
            res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'Request body contains invalid data',
                details: errorDetails,
                timestamp: new Date().toISOString()
            });
            return;
        }
        req.body = value;
        next();
    };
}
function validateRequestQuery(schema) {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
            convert: true
        });
        if (error) {
            const errorDetails = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                type: detail.type
            }));
            res.status(400).json({
                success: false,
                error: 'Query validation failed',
                message: 'Query parameters contain invalid data',
                details: errorDetails,
                timestamp: new Date().toISOString()
            });
            return;
        }
        req.query = value;
        next();
    };
}
function validateRequestParams(schema) {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.params, {
            abortEarly: false,
            stripUnknown: true,
            convert: true
        });
        if (error) {
            const errorDetails = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                type: detail.type
            }));
            res.status(400).json({
                success: false,
                error: 'Parameter validation failed',
                message: 'URL parameters contain invalid data',
                details: errorDetails,
                timestamp: new Date().toISOString()
            });
            return;
        }
        req.params = value;
        next();
    };
}
