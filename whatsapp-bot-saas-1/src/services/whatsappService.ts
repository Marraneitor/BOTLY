import axios from 'axios';
import { whatsappConfig } from '../config/whatsapp';
import { Bot } from '../models/Bot';

export class WhatsAppService {
    private apiUrl: string;

    constructor() {
        this.apiUrl = whatsappConfig.apiUrl;
    }

    async sendMessage(botId: string, message: string, recipient: string) {
        const bot = await Bot.findById(botId);
        if (!bot) {
            throw new Error('Bot not found');
        }

        const payload = {
            to: recipient,
            message: message,
            from: bot.phoneNumber,
        };

        try {
            const response = await axios.post(`${this.apiUrl}/send`, payload, {
                headers: {
                    'Authorization': `Bearer ${bot.apiToken}`,
                },
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    async getBotStatus(botId: string) {
        const bot = await Bot.findById(botId);
        if (!bot) {
            throw new Error('Bot not found');
        }

        try {
            const response = await axios.get(`${this.apiUrl}/status/${botId}`, {
                headers: {
                    'Authorization': `Bearer ${bot.apiToken}`,
                },
            });
            return response.data;
        } catch (error) {
            throw new Error(`Failed to get bot status: ${error.message}`);
        }
    }
}