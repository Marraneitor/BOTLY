import { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  // Deletes ALL existing entries
  await knex('users').del();

  // Inserts demo user
  await knex('users').insert([
    {
      id: 1,
      username: 'demoUser',
      password: 'demoPassword', // In a real application, ensure to hash passwords
      email: 'demo@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    },
  ]);
}