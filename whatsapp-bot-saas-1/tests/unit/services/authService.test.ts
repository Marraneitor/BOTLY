import { authService } from '../../../src/services/authService';
import { User } from '../../../src/models/User';

describe('authService', () => {
    describe('register', () => {
        it('should register a new user successfully', async () => {
            const userData = {
                email: 'test@example.com',
                password: 'password123',
                businessName: 'Test Business'
            };

            const user = await authService.register(userData);
            expect(user).toHaveProperty('id');
            expect(user.email).toBe(userData.email);
        });

        it('should throw an error if the user already exists', async () => {
            const userData = {
                email: 'test@example.com',
                password: 'password123',
                businessName: 'Test Business'
            };

            await authService.register(userData);

            await expect(authService.register(userData)).rejects.toThrow('User already exists');
        });
    });

    describe('login', () => {
        it('should log in a user successfully', async () => {
            const userData = {
                email: 'test@example.com',
                password: 'password123'
            };

            await authService.register({
                ...userData,
                businessName: 'Test Business'
            });

            const token = await authService.login(userData);
            expect(token).toBeDefined();
        });

        it('should throw an error for invalid credentials', async () => {
            const userData = {
                email: 'test@example.com',
                password: 'wrongpassword'
            };

            await expect(authService.login(userData)).rejects.toThrow('Invalid credentials');
        });
    });
});