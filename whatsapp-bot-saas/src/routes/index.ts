import { Router } from 'express';
import authRoutes from './authRoutes';
import businessRoutes from './businessRoutes';
import botRoutes from './botRoutes';
import deploymentRoutes from './deploymentRoutes';
import webhookRoutes from './webhookRoutes';

const router = Router();

const setupRoutes = (app) => {
    app.use('/api/auth', authRoutes);
    app.use('/api/business', businessRoutes);
    app.use('/api/bot', botRoutes);
    app.use('/api/deployment', deploymentRoutes);
    app.use('/api/webhook', webhookRoutes);
};

export default setupRoutes;