# Bot Discord Jogos Grátis

Bot em Node.js com `discord.js` para monitorar jogos temporariamente gratuitos e enviar anúncios em um canal configurado.

## O que ele faz

- Verifica jogos grátis a cada 1 hora.
- Monitora quando possível: Steam, Epic Games Store, GOG, Ubisoft Store, Microsoft Store / Xbox, itch.io e Prime Gaming.
- Envia embeds com nome, plataforma, preço original, link, data final, imagem, descrição curta e tipo da gratuidade.
- Evita duplicatas usando um arquivo JSON local.
- Oferece comandos slash para consultar, forçar busca e ver status.

## Arquivos principais

- [`index.js`](./index.js)
- [`database.js`](./database.js)
- [`services/searchGames.js`](./services/searchGames.js)
- [`utils/formatEmbed.js`](./utils/formatEmbed.js)
- [`deploy-commands.js`](./deploy-commands.js)

## Instalação

1. Instale as dependências:

```bash
npm install
```

2. Copie o arquivo de exemplo de ambiente para `.env` e preencha os valores:

```env
TOKEN_DISCORD=...
CLIENT_ID=...
GUILD_ID=...
CHANNEL_ID=...
```

3. Registre os comandos slash:

```bash
npm run deploy:commands
```

4. Inicie o bot:

```bash
npm start
```

## Observações

- O bot usa APIs públicas quando disponíveis e scraping com `axios` + `cheerio` quando necessário.
- Algumas lojas podem mudar o layout ou bloquear acesso em certos momentos. Nesses casos, a plataforma falha de forma isolada e o bot continua funcionando.
- Prime Gaming é o mais variável entre os provedores; se a página pública estiver indisponível, o conector simplesmente não retorna resultados.

## Comandos

- `/jogosgratis` lista os jogos mais recentes salvos.
- `/forcarbusca` executa uma busca manual.
- `/status` mostra o estado do bot e a última execução.
