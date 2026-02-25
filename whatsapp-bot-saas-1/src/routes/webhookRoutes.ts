import { Router } from 'express';
import WebhookController from '../controllers/webhookController';

const router = Router();
const webhookController = new WebhookController();

// Route to handle incoming webhook requests
router.post('/webhook', webhookController.handleWebhook);

export default router;