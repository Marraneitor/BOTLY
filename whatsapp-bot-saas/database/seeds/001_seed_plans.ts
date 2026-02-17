import { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  // Deletes ALL existing entries
  await knex('plans').del();

  // Inserts seed entries
  await knex('plans').insert([
    { id: 1, name: 'Free', price: 0, features: JSON.stringify(['Basic support', 'Limited messages']) },
    { id: 2, name: 'Pro', price: 29, features: JSON.stringify(['Priority support', 'Unlimited messages', 'Custom bot flows']) },
    { id: 3, name: 'Enterprise', price: 99, features: JSON.stringify(['Dedicated support', 'Advanced analytics', 'Custom integrations']) }
  ]);
}