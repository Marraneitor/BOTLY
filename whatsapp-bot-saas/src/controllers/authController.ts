import { Request, Response } from 'express';
import { authService } from '../services/authService';

class AuthController {
    async register(req: Request, res: Response) {
        try {
            const user = await authService.register(req.body);
            res.status(201).json(user);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async login(req: Request, res: Response) {
        try {
            const token = await authService.login(req.body);
            res.status(200).json({ token });
        } catch (error) {
            res.status(401).json({ message: error.message });
        }
    }

    async authenticate(req: Request, res: Response) {
        try {
            const user = await authService.authenticate(req.user);
            res.status(200).json(user);
        } catch (error) {
            res.status(401).json({ message: error.message });
        }
    }
}

export const authController = new AuthController();