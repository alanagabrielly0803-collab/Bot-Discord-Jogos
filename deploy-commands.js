require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

async function main() {
  const token = process.env.TOKEN_DISCORD;
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token || !clientId || !guildId) {
    throw new Error('Defina TOKEN_DISCORD, CLIENT_ID e GUILD_ID no .env antes de registrar os comandos.');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  console.log('Registrando comandos slash no servidor...');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Comandos registrados com sucesso.');
}

main().catch((error) => {
  console.error('Falha ao registrar comandos:', error);
  process.exit(1);
});
