import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('businesses', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('description').nullable();
        table.string('owner_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.string('whatsapp_number').notNullable();
        table.timestamps(true, true);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('businesses');
}