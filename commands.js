const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('jogosgratis')
    .setDescription('Lista os jogos gratuitos encontrados recentemente'),
  new SlashCommandBuilder()
    .setName('forcarbusca')
    .setDescription('Executa uma busca manual imediatamente'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Mostra o status do bot e a última execução')
].map((command) => command.toJSON());

module.exports = { commands };
