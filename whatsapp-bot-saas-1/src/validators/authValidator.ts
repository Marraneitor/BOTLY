import { body } from 'express-validator';

const authValidator = {
    register: [
        body('email')
            .isEmail()
            .withMessage('Please provide a valid email address.'),
        body('password')
            .isLength({ min: 6 })
            .withMessage('Password must be at least 6 characters long.'),
        body('confirmPassword')
            .custom((value, { req }) => {
                if (value !== req.body.password) {
                    throw new Error('Passwords do not match.');
                }
                return true;
            }),
    ],
    login: [
        body('email')
            .isEmail()
            .withMessage('Please provide a valid email address.'),
        body('password')
            .notEmpty()
            .withMessage('Password is required.'),
    ],
};

export default authValidator;