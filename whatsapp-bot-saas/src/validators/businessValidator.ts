import { body } from 'express-validator';

export const businessValidator = [
    body('name')
        .isString()
        .withMessage('Business name must be a string')
        .notEmpty()
        .withMessage('Business name is required'),
    
    body('description')
        .isString()
        .withMessage('Description must be a string')
        .optional(),
    
    body('website')
        .isURL()
        .withMessage('Website must be a valid URL')
        .optional(),
    
    body('phone')
        .isString()
        .withMessage('Phone number must be a string')
        .optional(),
    
    body('address')
        .isString()
        .withMessage('Address must be a string')
        .optional(),
    
    body('timezone')
        .isString()
        .withMessage('Timezone must be a string')
        .notEmpty()
        .withMessage('Timezone is required'),
];