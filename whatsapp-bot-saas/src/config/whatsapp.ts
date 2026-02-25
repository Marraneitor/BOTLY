import { WhatsAppConfig } from '../types/whatsapp';

const whatsappConfig: WhatsAppConfig = {
    apiKey: process.env.WHATSAPP_API_KEY || '',
    apiUrl: process.env.WHATSAPP_API_URL || 'https://api.whatsapp.com',
    webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || '',
    defaultReply: 'Thank you for contacting us! We will get back to you shortly.',
    supportedLanguages: ['en', 'es', 'fr'],
};

export default whatsappConfig;