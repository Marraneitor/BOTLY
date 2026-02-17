import request from 'supertest';
import app from '../../src/app';
import { createUser, createBot } from '../utils/testUtils';

describe('Bot Integration Tests', () => {
    let userToken: string;
    let botId: string;

    beforeAll(async () => {
        // Create a user and get the token
        const userResponse = await createUser();
        userToken = userResponse.token;

        // Create a bot for the user
        const botResponse = await createBot(userToken);
        botId = botResponse.id;
    });

    it('should retrieve the bot configuration', async () => {
        const response = await request(app)
            .get(`/api/bots/${botId}`)
            .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('id', botId);
    });

    it('should update the bot configuration', async () => {
        const updatedConfig = { name: 'Updated Bot Name' };

        const response = await request(app)
            .put(`/api/bots/${botId}`)
            .set('Authorization', `Bearer ${userToken}`)
            .send(updatedConfig);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('name', updatedConfig.name);
    });

    it('should delete the bot', async () => {
        const response = await request(app)
            .delete(`/api/bots/${botId}`)
            .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(204);
    });
});