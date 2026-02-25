import request from 'supertest';
import app from '../../src/app';
import { createUser, createBusiness, createDeployment } from '../helpers/testHelpers';

describe('Deployment Integration Tests', () => {
  let user;
  let business;

  beforeAll(async () => {
    user = await createUser();
    business = await createBusiness(user.id);
  });

  it('should deploy a bot successfully', async () => {
    const response = await request(app)
      .post('/api/deployments')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        businessId: business.id,
        botConfig: {
          name: 'Test Bot',
          webhookUrl: 'https://example.com/webhook',
        },
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('deploymentId');
    expect(response.body.message).toBe('Bot deployed successfully');
  });

  it('should return an error if business ID is invalid', async () => {
    const response = await request(app)
      .post('/api/deployments')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        businessId: 'invalid-id',
        botConfig: {
          name: 'Test Bot',
          webhookUrl: 'https://example.com/webhook',
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid business ID');
  });

  afterAll(async () => {
    await request(app)
      .delete(`/api/businesses/${business.id}`)
      .set('Authorization', `Bearer ${user.token}`);
    await request(app)
      .delete(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${user.token}`);
  });
});