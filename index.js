require('dotenv').config();

const {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits
} = require('discord.js');

const database = require('./database');
const { searchAllPlatforms } = require('./services/searchGames');
const {
  formatGameEmbed,
  formatRecentGamesEmbed,
  formatStatusEmbed,
  shorten
} = require('./utils/formatEmbed');

function getEnvValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

const TOKEN = getEnvValue('TOKEN_DISCORD', 'DISCORD_TOKEN', 'BOT_TOKEN');
const CHANNEL_ID = getEnvValue('CHANNEL_ID');
const SEARCH_INTERVAL_MS = 60 * 60 * 1000;

if (!TOKEN) {
  throw new Error(
    'Token do Discord nao definido. Configure TOKEN_DISCORD no ambiente do Render ou no arquivo .env local.'
  );
}

if (!CHANNEL_ID) {
  throw new Error('CHANNEL_ID nao definido. Configure a variavel de ambiente do canal.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  allowedMentions: { parse: [] }
});

let searchInProgress = false;
let lastSearchSummary = {
  startedAt: null,
  finishedAt: null,
  newCount: 0,
  foundCount: 0,
  errors: []
};

function formatRelativeDate(dateValue) {
  if (!dateValue) {
    return 'Nunca';
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

async function getTargetChannel() {
  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel || channel.type === ChannelType.DM) {
    return null;
  }
  return channel;
}

async function announceNewGames(games) {
  if (!games.length) {
    return;
  }

  const channel = await getTargetChannel();
  if (!channel || !channel.isTextBased()) {
    console.warn('Canal configurado não encontrado ou não é de texto.');
    return;
  }

  for (const game of games) {
    const embed = formatGameEmbed(game);
    await channel.send({ embeds: [embed] }).catch((error) => {
      console.error(`Falha ao enviar anúncio de "${game.title}":`, error);
    });
  }
}

async function runSearch({ manual = false } = {}) {
  if (searchInProgress) {
    return {
      skipped: true,
      message: 'Uma busca já está em andamento.'
    };
  }

  searchInProgress = true;
  const startedAt = new Date().toISOString();

  try {
    const { games, errors } = await searchAllPlatforms();
    const freshGames = [];

    for (const game of games) {
      if (!database.hasAnnounced(game.dedupeKey)) {
        database.markAnnounced(game);
        freshGames.push(game);
      }
    }

    database.addRecentGames(games);
    database.recordRun({
      startedAt,
      finishedAt: new Date().toISOString(),
      error: null,
      foundCount: games.length,
      newCount: freshGames.length
    });

    lastSearchSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      foundCount: games.length,
      newCount: freshGames.length,
      errors
    };

    if (freshGames.length) {
      await announceNewGames(freshGames);
    }

    return {
      skipped: false,
      manual,
      foundCount: games.length,
      newCount: freshGames.length,
      errors
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    database.recordRun({
      startedAt,
      finishedAt: new Date().toISOString(),
      error: errorMessage,
      foundCount: 0,
      newCount: 0
    });
    lastSearchSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      foundCount: 0,
      newCount: 0,
      errors: [errorMessage]
    };
    return {
      skipped: false,
      manual,
      foundCount: 0,
      newCount: 0,
      errors: [errorMessage]
    };
  } finally {
    searchInProgress = false;
  }
}

function scheduleSearchLoop() {
  setTimeout(async () => {
    await runSearch({ manual: false });
    setInterval(() => {
      runSearch({ manual: false }).catch((error) => {
        console.error('Erro inesperado na busca agendada:', error);
      });
    }, SEARCH_INTERVAL_MS);
  }, 15_000);
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  scheduleSearchLoop();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === 'forcarbusca') {
      await interaction.deferReply({ ephemeral: true });
      const result = await runSearch({ manual: true });
      if (result.skipped) {
        await interaction.editReply(result.message);
        return;
      }

      const summaryEmbed = new EmbedBuilder()
        .setTitle('Busca manual concluída')
        .setColor(result.newCount > 0 ? 0x2ecc71 : 0xf1c40f)
        .addFields(
          { name: 'Encontrados', value: String(result.foundCount), inline: true },
          { name: 'Novos anúncios', value: String(result.newCount), inline: true },
          { name: 'Erros por plataforma', value: result.errors.length ? result.errors.length.toString() : '0', inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [summaryEmbed] });
      return;
    }

    if (interaction.commandName === 'jogosgratis') {
      const recentGames = database.getRecentGames(10);
      const embed = formatRecentGamesEmbed(recentGames);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'status') {
      const status = database.getStatus();
      const embed = formatStatusEmbed(status);

      embed.addFields({
        name: 'Última busca em memória',
        value: lastSearchSummary.finishedAt ? formatRelativeDate(lastSearchSummary.finishedAt) : 'Nunca',
        inline: false
      });

      if (lastSearchSummary.errors.length) {
        embed.addFields({
          name: 'Erros recentes',
          value: shorten(lastSearchSummary.errors.join(' | '), 900),
          inline: false
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    console.error(`Erro ao executar comando ${interaction.commandName}:`, error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Ocorreu um erro ao processar este comando.').catch(() => null);
    } else {
      await interaction.reply({ content: 'Ocorreu um erro ao processar este comando.', ephemeral: true }).catch(() => null);
    }
  }
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(TOKEN);


