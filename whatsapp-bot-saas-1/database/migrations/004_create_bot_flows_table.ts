import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('bot_flows', (table) => {
        table.increments('id').primary();
        table.integer('bot_id').unsigned().references('id').inTable('bots').onDelete('CASCADE');
        table.string('flow_name').notNullable();
        table.json('flow_data').notNullable();
        table.timestamps(true, true);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('bot_flows');
}