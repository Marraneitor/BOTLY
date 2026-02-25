import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';

export const validateUserRegistration = [
    body('username').isString().notEmpty().withMessage('Username is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    (req: Request, res: Response, next: NextFunction) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

export const validateBusinessConfiguration = [
    body('businessName').isString().notEmpty().withMessage('Business name is required'),
    body('businessType').isString().notEmpty().withMessage('Business type is required'),
    (req: Request, res: Response, next: NextFunction) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

export const validateBotConfiguration = [
    body('botName').isString().notEmpty().withMessage('Bot name is required'),
    body('whatsappNumber').isMobilePhone('any').withMessage('Valid WhatsApp number is required'),
    (req: Request, res: Response, next: NextFunction) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];