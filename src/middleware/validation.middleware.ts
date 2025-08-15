import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export function validateRequestBody(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Retornar todos os erros
      stripUnknown: true, // Remover campos não definidos no schema
      convert: true // Converter tipos quando possível
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

    // Substituir req.body pelos valores validados e processados
    req.body = value;
    next();
  };
}

export function validateRequestQuery(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
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

export function validateRequestParams(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
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