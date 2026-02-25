import { BotService } from '../../../src/services/botService';
import { Bot } from '../../../src/models/Bot';

describe('BotService', () => {
    let botService: BotService;

    beforeEach(() => {
        botService = new BotService();
    });

    describe('createBot', () => {
        it('should create a new bot', async () => {
            const botData = {
                name: 'Test Bot',
                businessId: '12345',
                configuration: {},
            };

            const createdBot = await botService.createBot(botData);
            expect(createdBot).toBeInstanceOf(Bot);
            expect(createdBot.name).toBe(botData.name);
        });
    });

    describe('getBot', () => {
        it('should retrieve a bot by ID', async () => {
            const botId = '12345';
            const bot = await botService.getBot(botId);
            expect(bot).toBeDefined();
            expect(bot.id).toBe(botId);
        });
    });

    describe('updateBot', () => {
        it('should update an existing bot', async () => {
            const botId = '12345';
            const updateData = { name: 'Updated Bot' };
            const updatedBot = await botService.updateBot(botId, updateData);
            expect(updatedBot.name).toBe(updateData.name);
        });
    });

    describe('deleteBot', () => {
        it('should delete a bot by ID', async () => {
            const botId = '12345';
            const result = await botService.deleteBot(botId);
            expect(result).toBe(true);
        });
    });
});