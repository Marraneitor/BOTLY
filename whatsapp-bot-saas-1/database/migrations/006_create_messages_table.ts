import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('messages', (table) => {
    table.increments('id').primary();
    table.integer('bot_id').unsigned().notNullable();
    table.string('content').notNullable();
    table.string('sender').notNullable();
    table.timestamp('sent_at').defaultTo(knex.fn.now());
    
    table.foreign('bot_id').references('id').inTable('bots').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('messages');
}