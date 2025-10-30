import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

const sessions = new Map();

client.once('ready', () => {
  console.log(`✅ Logget inn som ${client.user.tag}`);
});

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function teamsEmbed(vcName, teamA, teamB) {
  return new EmbedBuilder()
    .setAuthor({ name: 'RandomTeamGen' })
    .setTitle('Game generated')
    .addFields(
      { name: 'Team A', value: teamA.map(id => `<@${id}>`).join('\n') || '—', inline: true },
      { name: 'Team B', value: teamB.map(id => `<@${id}>`).join('\n') || '—', inline: true },
    )
    .setFooter({ text: 'Draft created' })
    .setTimestamp();
}

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash: /game
    if (interaction.isChatInputCommand() && interaction.commandName === 'game') {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const voice = member?.voice?.channel;

      // Svar raskt hvis bruker ikke er i voice (ephemeral)
      if (!voice) {
        return interaction.reply({ content: 'Du må være i en voice-kanal først.', ephemeral: true });
      }

      // Defer NÅ (offentlig), så vi har mer enn 3 sek å jobbe på
      await interaction.deferReply();

      const members = [...voice.members.values()].filter(m => !m.user.bot).map(m => m.id);
      if (members.length < 2) {
        return interaction.editReply('Trenger minst 2 personer i voice for å splitte.');
      }

      const shuffled = shuffle(members);
      const teamA = shuffled.slice(0, Math.ceil(shuffled.length / 2));
      const teamB = shuffled.slice(Math.ceil(shuffled.length / 2));

      sessions.set(interaction.guildId, {
        originalChannelId: voice.id,
        teamA,
        teamB,
        chanA: null,
        chanB: null,
      });

      const embed = teamsEmbed(voice.name, teamA, teamB);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('create_game').setLabel('Create game').setStyle(ButtonStyle.Success)
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // Slash: /end
    if (interaction.isChatInputCommand() && interaction.commandName === 'end') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.reply({ content: 'Ingen aktiv session. Kjør /game først.', ephemeral: true });
      }

      await interaction.deferReply(); // gi oss tid

      const guild = interaction.guild;
      const backId = session.originalChannelId;

      const moveBack = async (chanId) => {
        const chan = guild.channels.cache.get(chanId);
        if (!chan) return;
        for (const [, m] of chan.members) {
          await m.voice.setChannel(backId).catch(() => {});
        }
        await chan.delete().catch(() => {});
      };

      await moveBack(session.chanA);
      await moveBack(session.chanB);

      sessions.delete(interaction.guildId);
      return interaction.editReply('🧹 Game ended — everyone moved back!');
    }

    // Button: Create game
    if (interaction.isButton() && interaction.customId === 'create_game') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.reply({ content: 'Ingen aktiv session. Kjør /game først.', ephemeral: true });
      }

      await interaction.deferReply(); // gi oss tid

      const guild = interaction.guild;
      const parent = guild.channels.cache.get(session.originalChannelId)?.parentId ?? null;

      const chanA = await guild.channels.create({ name: 'Team A', type: ChannelType.GuildVoice, parent }).catch(() => null);
      const chanB = await guild.channels.create({ name: 'Team B', type: ChannelType.GuildVoice, parent }).catch(() => null);
      if (!chanA || !chanB) return interaction.editReply('Manglende rettigheter til å lage kanaler.');

      session.chanA = chanA.id;
      session.chanB = chanB.id;

      // Flytt medlemmer (kan ta litt tid – derfor defer)
      for (const id of session.teamA) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m?.voice?.channelId) await m.voice.setChannel(chanA).catch(() => {});
      }
      for (const id of session.teamB) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m?.voice?.channelId) await m.voice.setChannel(chanB).catch(() => {});
      }

      return interaction.editReply('✅ Game created and members moved!');
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({ content: 'Noe gikk galt 😅 Prøv igjen.', ephemeral: true }).catch(() => {});
    } else if (!interaction.replied) {
      return interaction.editReply('Noe gikk galt 😅 Prøv igjen.').catch(() => {});
    }
  }
});

// ekstra: fang uventede promise-feil så botten ikke dør i stillhet
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));

client.login(process.env.DISCORD_TOKEN);
