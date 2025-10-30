import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers, // husk å aktivere i Dev Portal
  ],
});

// guildId -> session data
// {
//   originalChannelId, teamA, teamB,
//   chanA, chanB,
//   teamsMessageId, teamsChannelId
// }
const sessions = new Map();

client.once('ready', () => {
  console.log(`✅ Logget inn som ${client.user.tag}`);
  // Valgfritt: vis status
  client.user.setPresence({
    activities: [{ name: '/game', type: 0 }],
    status: 'online',
  });
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
    .setDescription(`Voice: **${vcName}**`)
    .addFields(
      { name: 'Team A', value: teamA.map(id => `<@${id}>`).join('\n') || '—', inline: true },
      { name: 'Team B', value: teamB.map(id => `<@${id}>`).join('\n') || '—', inline: true },
    )
    .setFooter({ text: 'Draft created' })
    .setTimestamp();
}

function createButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('create_game').setLabel('Create game').setStyle(ButtonStyle.Success)
  );
}

async function ensurePerms(interaction) {
  const me = await interaction.guild.members.fetchMe();
  const need = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
  ];
  const missing = need.filter(p => !me.permissions.has(p));
  if (missing.length) {
    throw new Error('MISSING_PERMS');
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    // -------------------------
    // /game
    // -------------------------
    if (interaction.isChatInputCommand() && interaction.commandName === 'game') {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const voice = member?.voice?.channel;
      if (!voice) return interaction.reply({ content: 'Du må være i en voice-kanal først.', ephemeral: true });

      const members = [...voice.members.values()].filter(m => !m.user.bot).map(m => m.id);
      if (members.length < 2) return interaction.reply({ content: 'Trenger minst 2 personer i voice.', ephemeral: true });

      const shuffled = shuffle(members);
      const teamA = shuffled.slice(0, Math.ceil(shuffled.length / 2));
      const teamB = shuffled.slice(Math.ceil(shuffled.length / 2));

      const embed = teamsEmbed(voice.name, teamA, teamB);
      const row = createButtonRow();

      // Viktig: hent selve meldingen vi sendte (for å kunne oppdatere den ved /end)
      const sent = await interaction.reply({
        embeds: [embed],
        components: [row],
        fetchReply: true,
      });

      sessions.set(interaction.guildId, {
        originalChannelId: voice.id,
        teamA,
        teamB,
        chanA: null,
        chanB: null,
        teamsMessageId: sent.id,
        teamsChannelId: sent.channelId,
      });

      return;
    }

    // -------------------------
    // Button: Create game
    // -------------------------
    if (interaction.isButton() && interaction.customId === 'create_game') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.reply({ content: 'Ingen aktiv session. Kjør /game først.', ephemeral: true });
      }

      await ensurePerms(interaction);

      // Defer ephemeral, så vi unngår 3s-timeout og ikke spammer kanalen
      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      // Opprett to voice-kanaler i samme kategori som originalen (hvis mulig)
      const parent = guild.channels.cache.get(session.originalChannelId)?.parentId ?? null;

      const chanA = await guild.channels.create({
        name: 'Team A',
        type: ChannelType.GuildVoice,
        parent,
        reason: 'Create game (Team A)',
      }).catch(() => null);

      const chanB = await guild.channels.create({
        name: 'Team B',
        type: ChannelType.GuildVoice,
        parent,
        reason: 'Create game (Team B)',
      }).catch(() => null);

      if (!chanA || !chanB) {
        return interaction.editReply('Mangler rettigheter til å lage kanaler.');
      }

      session.chanA = chanA.id;
      session.chanB = chanB.id;

      // Flytt medlemmer
      for (const id of session.teamA) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m?.voice?.channelId) await m.voice.setChannel(chanA).catch(() => {});
      }
      for (const id of session.teamB) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m?.voice?.channelId) await m.voice.setChannel(chanB).catch(() => {});
      }

      await interaction.editReply('✅ Game created and members moved!');
      return;
    }

    // -------------------------
    // /end
    // -------------------------
    if (interaction.isChatInputCommand() && interaction.commandName === 'end') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.reply({ content: 'Ingen aktiv session. Kjør /game først.', ephemeral: true });
      }

      await ensurePerms(interaction);
      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      const backId = session.originalChannelId;

      // Flytt alle tilbake og slett midlertidige kanaler
      const moveBack = async (chanId) => {
        const chan = guild.channels.cache.get(chanId);
        if (!chan || chan.type !== ChannelType.GuildVoice) return;
        for (const [, m] of chan.members) {
          await m.voice.setChannel(backId).catch(() => {});
        }
        await chan.delete('End game').catch(() => {});
      };

      await moveBack(session.chanA);
      await moveBack(session.chanB);

      // Oppdater lag-meldingen: fjern knapper + sett footer til "Game ended"
      try {
        const ch = await guild.channels.fetch(session.teamsChannelId).catch(() => null);
        if (ch && ch.isTextBased()) {
          const msg = await ch.messages.fetch(session.teamsMessageId).catch(() => null);
          if (msg) {
            const old = msg.embeds?.[0];
            const newEmbed = old ? EmbedBuilder.from(old).setFooter({ text: 'Game ended' }) : null;
            await msg.edit({
              embeds: newEmbed ? [newEmbed] : msg.embeds,
              components: [], // fjern knapper
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('Kunne ikke oppdatere teams-meldingen:', e?.message);
      }

      sessions.delete(interaction.guildId);
      await interaction.editReply('🧹 Game ended — everyone moved back!');
      return;
    }
  } catch (err) {
    console.error('Interaction error:', err);
    // Gi brukeren en beskjed uten å spamme kanalen
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Noe gikk galt 😅 Prøv igjen.', ephemeral: true });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply('Noe gikk galt 😅 Prøv igjen.');
      }
    } catch {}
    if (err.message === 'MISSING_PERMS') {
      console.error('Mangler nødvendige rettigheter: ManageChannels, MoveMembers, ViewChannel, Connect.');
    }
  }
});

// Ekstra: ikke la uventede feil drepe prosessen i stillhet
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));

client.login(process.env.DISCORD_TOKEN);
