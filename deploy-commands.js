import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('game')
    .setDescription('Split folk i voice-kanalen i to tilfeldige lag.'),
  new SlashCommandBuilder()
    .setName('end')
    .setDescription('Avslutt spillet og flytt alle tilbake.'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  try {
    console.log('🛠️  Registrerer kommandoer...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Ferdig! Slash-kommandoer lagt til.');
  } catch (err) {
    console.error(err);
  }
}

main();
