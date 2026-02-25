import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('subscriptions', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().notNullable();
        table.string('plan').notNullable();
        table.date('start_date').notNullable();
        table.date('end_date').notNullable();
        table.boolean('is_active').defaultTo(true);
        table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('subscriptions');
}