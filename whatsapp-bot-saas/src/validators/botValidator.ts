import { body } from 'express-validator';

const botValidator = {
    createBot: [
        body('name')
            .isString()
            .withMessage('Bot name must be a string')
            .notEmpty()
            .withMessage('Bot name is required'),
        body('description')
            .isString()
            .withMessage('Description must be a string')
            .optional(),
        body('businessId')
            .isString()
            .withMessage('Business ID must be a string')
            .notEmpty()
            .withMessage('Business ID is required'),
        body('webhookUrl')
            .isURL()
            .withMessage('Webhook URL must be a valid URL')
            .notEmpty()
            .withMessage('Webhook URL is required'),
    ],
    updateBot: [
        body('name')
            .isString()
            .withMessage('Bot name must be a string')
            .optional(),
        body('description')
            .isString()
            .withMessage('Description must be a string')
            .optional(),
        body('webhookUrl')
            .isURL()
            .withMessage('Webhook URL must be a valid URL')
            .optional(),
    ],
};

export default botValidator;