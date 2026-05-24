const { EmbedBuilder } = require('discord.js');

const PLATFORM_COLORS = {
  'Epic Games Store': 0x2f80ed,
  Steam: 0x1b2838,
  GOG: 0x7b4eff,
  'Ubisoft Store': 0x00b7ff,
  'Microsoft Store': 0x107c10,
  'itch.io': 0xff5e5b,
  'Prime Gaming': 0x9146ff,
  Geral: 0x2ecc71
};

function shorten(text, maxLength = 280) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatDate(value) {
  if (!value) {
    return 'Não informado';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') {
    return 'Não informado';
  }
  return String(value);
}

function getPlatformColor(platform) {
  return PLATFORM_COLORS[platform] || PLATFORM_COLORS.Geral;
}

function formatGameEmbed(game) {
  const embed = new EmbedBuilder()
    .setTitle(game.title)
    .setColor(getPlatformColor(game.platform))
    .setDescription(shorten(game.description || 'Sem descrição disponível.', 350))
    .addFields(
      { name: 'Plataforma', value: game.platform || 'Não informado', inline: true },
      { name: 'Preço original', value: formatMoney(game.originalPrice), inline: true },
      { name: 'Tipo da gratuidade', value: game.freeType || 'Não informado', inline: true },
      { name: 'Data final', value: formatDate(game.endDate), inline: true },
      { name: 'Link para resgatar', value: game.claimUrl ? `[Abrir link](${game.claimUrl})` : 'Não informado', inline: false }
    )
    .setFooter({ text: 'Monitoramento automático de jogos gratuitos' })
    .setTimestamp();

  if (game.claimUrl || game.sourceUrl) {
    embed.setURL(game.claimUrl || game.sourceUrl);
  }

  if (game.image) {
    embed.setImage(game.image);
  }

  return embed;
}

function formatRecentGamesEmbed(games) {
  const embed = new EmbedBuilder()
    .setTitle('Jogos gratuitos encontrados recentemente')
    .setColor(0x2ecc71)
    .setDescription(
      games.length
        ? 'Aqui estão os jogos mais recentes salvos pelo monitoramento.'
        : 'Nenhum jogo gratuito foi salvo ainda.'
    )
    .setTimestamp();

  if (games.length) {
    const items = games.slice(0, 10).map((game) => {
      const endDate = formatDate(game.endDate);
      return `**${shorten(game.title, 70)}**\n${game.platform} · ${game.freeType || 'Sem tipo'} · até ${endDate}`;
    });
    embed.addFields({ name: 'Últimos encontrados', value: items.join('\n\n') });
  }

  return embed;
}

function formatStatusEmbed(status) {
  const lastRun = status.lastRun
    ? `${formatDate(status.lastRun.finishedAt)} (${status.lastRun.ok ? 'ok' : 'erro'})`
    : 'Nunca';
  const lastSuccess = status.lastSuccessfulRun ? formatDate(status.lastSuccessfulRun) : 'Nunca';

  return new EmbedBuilder()
    .setTitle('Status do bot')
    .setColor(0x3498db)
    .addFields(
      { name: 'Total de buscas', value: String(status.totalRuns || 0), inline: true },
      { name: 'Jogos salvos', value: String(status.announcedCount || 0), inline: true },
      { name: 'Jogos recentes', value: String(status.recentCount || 0), inline: true },
      { name: 'Última execução', value: lastRun, inline: false },
      { name: 'Último sucesso', value: lastSuccess, inline: false },
      { name: 'Último erro', value: status.lastError || 'Nenhum', inline: false }
    )
    .setTimestamp();
}

module.exports = {
  formatGameEmbed,
  formatRecentGamesEmbed,
  formatStatusEmbed,
  formatDate,
  shorten
};
