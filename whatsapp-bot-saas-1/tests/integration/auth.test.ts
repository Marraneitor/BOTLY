import request from 'supertest';
import app from '../../src/app';
import { User } from '../../src/models/User';

describe('Authentication Integration Tests', () => {
  let user;

  beforeAll(async () => {
    user = await User.create({
      username: 'testuser',
      password: 'testpassword',
      email: 'testuser@example.com',
    });
  });

  afterAll(async () => {
    await User.deleteMany({}); // Clean up the test user
  });

  it('should register a new user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'newuser',
        password: 'newpassword',
        email: 'newuser@example.com',
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('token');
  });

  it('should login an existing user', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'testuser@example.com',
        password: 'testpassword',
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
  });

  it('should fail to login with incorrect password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'testuser@example.com',
        password: 'wrongpassword',
      });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('message', 'Invalid credentials');
  });

  it('should fail to register with existing email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'testuser',
        password: 'testpassword',
        email: 'testuser@example.com',
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message', 'Email already in use');
  });
});