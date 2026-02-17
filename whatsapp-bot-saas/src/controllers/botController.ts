import { Request, Response } from 'express';
import { BotService } from '../services/botService';

export class BotController {
    private botService: BotService;

    constructor() {
        this.botService = new BotService();
    }

    public async createBot(req: Request, res: Response): Promise<void> {
        try {
            const botData = req.body;
            const newBot = await this.botService.createBot(botData);
            res.status(201).json(newBot);
        } catch (error) {
            res.status(500).json({ message: 'Error creating bot', error });
        }
    }

    public async getBot(req: Request, res: Response): Promise<void> {
        try {
            const botId = req.params.id;
            const bot = await this.botService.getBotById(botId);
            if (bot) {
                res.status(200).json(bot);
            } else {
                res.status(404).json({ message: 'Bot not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error fetching bot', error });
        }
    }

    public async updateBot(req: Request, res: Response): Promise<void> {
        try {
            const botId = req.params.id;
            const botData = req.body;
            const updatedBot = await this.botService.updateBot(botId, botData);
            if (updatedBot) {
                res.status(200).json(updatedBot);
            } else {
                res.status(404).json({ message: 'Bot not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error updating bot', error });
        }
    }

    public async deleteBot(req: Request, res: Response): Promise<void> {
        try {
            const botId = req.params.id;
            const result = await this.botService.deleteBot(botId);
            if (result) {
                res.status(204).send();
            } else {
                res.status(404).json({ message: 'Bot not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error deleting bot', error });
        }
    }
}