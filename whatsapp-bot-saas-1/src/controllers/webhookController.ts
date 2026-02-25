import { Request, Response } from 'express';

class WebhookController {
    public handleIncomingWebhook(req: Request, res: Response): void {
        const incomingMessage = req.body;

        // Process the incoming message from WhatsApp
        // Add your logic here to handle the message

        res.status(200).send('Webhook received');
    }
}

export default new WebhookController();