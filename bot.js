/* ========================================
   NexaKS Discord Bot
   6 slash commands: redeem, resethwid, keyinfo, generate, revoke, lookup
   ======================================== */

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// ========== Config from env ==========
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const VERIFIED_ROLE_ID = process.env.DISCORD_VERIFIED_ROLE_ID; // optional
const ADMIN_ROLE_ID = process.env.DISCORD_ADMIN_ROLE_ID; // optional - for admin commands
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!BOT_TOKEN || !CLIENT_ID) {
    console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID');
    global.botStatus = 'error: missing config';
    return;
}

if (!SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_SERVICE_KEY - bot needs it to bypass RLS');
    global.botStatus = 'error: missing service key';
    return;
}

// Supabase client with SERVICE ROLE (bypasses RLS)
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ========== Command definitions ==========
const commands = [
    new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Redeem a NexaKS license key')
        .addStringOption(opt => opt.setName('key').setDescription('Your license key (NXKS-...)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset your hardware ID (24h cooldown)'),

    new SlashCommandBuilder()
        .setName('keyinfo')
        .setDescription('View your active license details'),

    new SlashCommandBuilder()
        .setName('generate')
        .setDescription('[Admin] Generate license keys')
        .addStringOption(opt => opt.setName('plan').setDescription('Plan tier').setRequired(true)
            .addChoices({name:'Free',value:'free'},{name:'Pro',value:'pro'},{name:'Enterprise',value:'enterprise'}))
        .addStringOption(opt => opt.setName('duration').setDescription('Duration').setRequired(true)
            .addChoices({name:'1 day',value:'1'},{name:'7 days',value:'7'},{name:'30 days',value:'30'},
                {name:'90 days',value:'90'},{name:'1 year',value:'365'},{name:'Lifetime',value:'lifetime'}))
        .addIntegerOption(opt => opt.setName('quantity').setDescription('How many keys (default 1)').setMinValue(1).setMaxValue(50)),

    new SlashCommandBuilder()
        .setName('revoke')
        .setDescription('[Admin] Revoke a license key')
        .addStringOption(opt => opt.setName('key').setDescription('Key to revoke').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('[Admin] Look up a user\'s license info')
        .addUserOption(opt => opt.setName('user').setDescription('Discord user').setRequired(true))
].map(cmd => cmd.toJSON());

// ========== Register commands ==========
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
            console.log('Registered commands for guild ' + GUILD_ID);
        } else {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('Registered global commands (may take up to 1 hour to appear)');
        }
    } catch (err) {
        console.error('Command registration failed:', err);
    }
}

// ========== Helpers ==========
async function isAdmin(interaction) {
    // Check DB is_admin first
    const { data: user } = await sb.from('users')
        .select('is_admin').eq('discord_id', interaction.user.id).maybeSingle();
    if (user?.is_admin) return true;

    // Fallback: Discord role check
    if (ADMIN_ROLE_ID && interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID)) return true;

    return false;
}

async function ensureUserRow(discordUser) {
    const { data: existing } = await sb.from('users')
        .select('*').eq('discord_id', discordUser.id).maybeSingle();
    if (existing) return existing;

    // Create fresh row (they haven't logged into web yet)
    const { data: created, error } = await sb.from('users').insert({
        id: crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID(),
        discord_id: discordUser.id,
        username: discordUser.username || discordUser.globalName || 'User',
        avatar_url: discordUser.displayAvatarURL ? discordUser.displayAvatarURL() : null
    }).select().single();

    if (error) {
        console.error('Failed to create user row:', error);
        return null;
    }
    return created;
}

async function assignVerifiedRole(interaction) {
    if (!VERIFIED_ROLE_ID || !interaction.member) return;
    try {
        await interaction.member.roles.add(VERIFIED_ROLE_ID);
        await sb.from('users').update({ discord_role_assigned: true })
            .eq('discord_id', interaction.user.id);
    } catch (err) {
        console.warn('Could not assign role:', err.message);
    }
}

function generateKeyString() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segs = [];
    for (let s = 0; s < 4; s++) {
        let seg = '';
        for (let i = 0; i < 4; i++) seg += chars.charAt(Math.floor(Math.random() * chars.length));
        segs.push(seg);
    }
    return 'NXKS-' + segs.join('-');
}

function embed(title, description, color) {
    return new EmbedBuilder()
        .setColor(color || 0x7c3aed)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: 'NexaKS' })
        .setTimestamp();
}

// ========== Command handlers ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        const cmd = interaction.commandName;

        // ===== /redeem =====
        if (cmd === 'redeem') {
            await interaction.deferReply({ ephemeral: true });
            const key = interaction.options.getString('key').trim().toUpperCase();

            if (!key.startsWith('NXKS-')) {
                return interaction.editReply({ embeds: [embed('Invalid Key', 'License key must start with `NXKS-`', 0xef4444)] });
            }

            const user = await ensureUserRow(interaction.user);
            if (!user) return interaction.editReply({ embeds: [embed('Error', 'Could not create user profile. Try again.', 0xef4444)] });

            const { data: existingKey } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
            if (!existingKey) return interaction.editReply({ embeds: [embed('Not Found', 'License key does not exist.', 0xef4444)] });
            if (existingKey.status === 'revoked') return interaction.editReply({ embeds: [embed('Revoked', 'This key has been revoked.', 0xef4444)] });
            if (existingKey.user_id && existingKey.user_id !== user.id) {
                return interaction.editReply({ embeds: [embed('Already Claimed', 'This key is already bound to another user.', 0xef4444)] });
            }

            const updates = { user_id: user.id, status: 'active', redeemed_via: 'discord' };
            if (existingKey.duration_days && !existingKey.expires_at) {
                const exp = new Date();
                exp.setDate(exp.getDate() + existingKey.duration_days);
                updates.expires_at = exp.toISOString();
            }

            const { error } = await sb.from('keys').update(updates).eq('key', key);
            if (error) return interaction.editReply({ embeds: [embed('Error', 'Redeem failed: ' + error.message, 0xef4444)] });

            await sb.from('logs').insert({
                user_id: user.id, key: key,
                action: 'redeem', status: 'success',
                metadata: { message: 'Redeemed via Discord bot', source: 'discord' }
            });

            await assignVerifiedRole(interaction);

            const expText = updates.expires_at
                ? new Date(updates.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : 'Lifetime';
            return interaction.editReply({
                embeds: [embed('License Activated',
                    '**Plan:** ' + existingKey.plan.toUpperCase() + '\n' +
                    '**Expires:** ' + expText + '\n' +
                    '**Key:** `' + key + '`\n\n' +
                    'View your dashboard: ' + (process.env.SITE_URL || 'https://keyora-gyuu.onrender.com') + '/dashboard',
                    0x10b981)]
            });
        }

        // ===== /resethwid =====
        if (cmd === 'resethwid') {
            await interaction.deferReply({ ephemeral: true });
            const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
            if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first with `/redeem`.', 0xef4444)] });

            const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (!key) return interaction.editReply({ embeds: [embed('No Active License', 'You have no active license to reset.', 0xef4444)] });

            if (key.last_hwid_reset) {
                const hrs = (new Date() - new Date(key.last_hwid_reset)) / 3600000;
                if (hrs < 24) {
                    return interaction.editReply({ embeds: [embed('Cooldown Active',
                        'Please wait **' + Math.ceil(24 - hrs) + ' hours** before resetting again.', 0xf59e0b)] });
                }
            }

            if ((key.hwid_reset_count || 0) >= (key.hwid_reset_limit || 5)) {
                return interaction.editReply({ embeds: [embed('Limit Reached',
                    'You have used all ' + (key.hwid_reset_limit || 5) + ' resets. Contact an admin.', 0xef4444)] });
            }

            const { error } = await sb.from('keys').update({
                hwid: null,
                hwid_reset_count: (key.hwid_reset_count || 0) + 1,
                last_hwid_reset: new Date().toISOString()
            }).eq('key', key.key);

            if (error) return interaction.editReply({ embeds: [embed('Error', 'Reset failed: ' + error.message, 0xef4444)] });

            await sb.from('logs').insert({
                user_id: user.id, key: key.key,
                action: 'reset_hwid', status: 'success',
                metadata: { message: 'HWID reset via Discord bot', source: 'discord' }
            });

            const remaining = (key.hwid_reset_limit || 5) - (key.hwid_reset_count + 1);
            return interaction.editReply({ embeds: [embed('HWID Reset',
                'Your hardware ID has been cleared. Run your script again to bind a new device.\n\n' +
                '**Resets remaining:** ' + remaining, 0x10b981)] });
        }

        // ===== /keyinfo =====
        if (cmd === 'keyinfo') {
            await interaction.deferReply({ ephemeral: true });
            const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
            if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first with `/redeem`.', 0xef4444)] });

            const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (!key) return interaction.editReply({ embeds: [embed('No Active License', 'You have no active license.', 0xef4444)] });

            const expText = key.expires_at
                ? new Date(key.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Lifetime';
            const hwidText = key.hwid ? '`' + key.hwid.substring(0, 12) + '...`' : 'Not bound';
            const resetsUsed = key.hwid_reset_count || 0;
            const resetsLimit = key.hwid_reset_limit || 5;

            return interaction.editReply({ embeds: [embed('Your License',
                '**Key:** `' + key.key + '`\n' +
                '**Plan:** ' + key.plan.toUpperCase() + '\n' +
                '**Status:** ' + key.status + '\n' +
                '**Expires:** ' + expText + '\n' +
                '**Hardware ID:** ' + hwidText + '\n' +
                '**HWID Resets:** ' + resetsUsed + '/' + resetsLimit + '\n' +
                '**Executions:** ' + (key.execution_count || 0),
                0x7c3aed)]
            });
        }

        // ===== /generate (admin) =====
        if (cmd === 'generate') {
            await interaction.deferReply({ ephemeral: true });
            if (!(await isAdmin(interaction))) {
                return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
            }

            const plan = interaction.options.getString('plan');
            const duration = interaction.options.getString('duration');
            const qty = interaction.options.getInteger('quantity') || 1;

            const user = await ensureUserRow(interaction.user);

            const keys = [];
            const rows = [];
            for (let i = 0; i < qty; i++) {
                const k = generateKeyString();
                keys.push(k);
                rows.push({
                    key: k, plan: plan,
                    duration_days: duration === 'lifetime' ? null : parseInt(duration),
                    hwid_reset_limit: 5,
                    status: 'unclaimed',
                    created_by: user?.id
                });
            }

            const { error } = await sb.from('keys').insert(rows);
            if (error) return interaction.editReply({ embeds: [embed('Error', 'Generation failed: ' + error.message, 0xef4444)] });

            await sb.from('logs').insert({
                user_id: user?.id,
                action: 'admin_generate', status: 'success',
                metadata: { message: 'Generated ' + qty + ' ' + plan + ' keys via Discord bot (' + duration + ')' }
            });

            const keyList = keys.map(k => '`' + k + '`').join('\n');
            return interaction.editReply({ embeds: [embed('Keys Generated',
                'Generated **' + qty + '** ' + plan.toUpperCase() + ' keys (' + duration + (duration === 'lifetime' ? '' : ' days') + ')\n\n' +
                keyList + '\n\n*Save these â€” hindi na uulit yung display*',
                0x10b981)]
            });
        }

        // ===== /revoke (admin) =====
        if (cmd === 'revoke') {
            await interaction.deferReply({ ephemeral: true });
            if (!(await isAdmin(interaction))) {
                return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
            }

            const key = interaction.options.getString('key').trim().toUpperCase();
            const { data: existing } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
            if (!existing) return interaction.editReply({ embeds: [embed('Not Found', 'Key does not exist.', 0xef4444)] });

            const { error } = await sb.from('keys').update({ status: 'revoked' }).eq('key', key);
            if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

            const admin = await ensureUserRow(interaction.user);
            await sb.from('logs').insert({
                user_id: admin?.id, key: key,
                action: 'admin_revoke', status: 'success',
                metadata: { message: 'Revoked via Discord bot by ' + interaction.user.username }
            });

            return interaction.editReply({ embeds: [embed('Key Revoked',
                '`' + key + '` has been revoked. User loses access immediately.', 0x10b981)] });
        }

        // ===== /lookup (admin) =====
        if (cmd === 'lookup') {
            await interaction.deferReply({ ephemeral: true });
            if (!(await isAdmin(interaction))) {
                return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
            }

            const targetUser = interaction.options.getUser('user');
            const { data: user } = await sb.from('users').select('*').eq('discord_id', targetUser.id).maybeSingle();
            if (!user) return interaction.editReply({ embeds: [embed('Not Registered',
                targetUser.username + ' has not signed in to NexaKS yet.', 0xf59e0b)] });

            const { data: keys } = await sb.from('keys').select('*').eq('user_id', user.id)
                .order('created_at', { ascending: false });

            const active = (keys || []).filter(k => k.status === 'active');
            const revoked = (keys || []).filter(k => k.status === 'revoked');

            const keySummary = active.length > 0
                ? active.map(k => '`' + k.key + '` - ' + k.plan.toUpperCase() +
                    (k.expires_at ? ' (expires ' + new Date(k.expires_at).toLocaleDateString() + ')' : ' (lifetime)')).join('\n')
                : 'No active keys';

            return interaction.editReply({ embeds: [embed('User: ' + (user.username || targetUser.username),
                '**Discord ID:** ' + targetUser.id + '\n' +
                '**Joined NexaKS:** ' + new Date(user.created_at).toLocaleDateString() + '\n' +
                '**Admin:** ' + (user.is_admin ? 'Yes' : 'No') + '\n' +
                '**Banned:** ' + (user.is_banned ? 'Yes' : 'No') + '\n' +
                '**Total keys:** ' + (keys?.length || 0) + ' (' + active.length + ' active, ' + revoked.length + ' revoked)\n\n' +
                '**Active Keys:**\n' + keySummary,
                0x7c3aed)]
            });
        }

    } catch (err) {
        console.error('Command error:', err);
        try {
            const msg = { embeds: [embed('Bot Error', 'Something went wrong: ' + err.message, 0xef4444)] };
            if (interaction.deferred) await interaction.editReply(msg);
            else await interaction.reply({ ...msg, ephemeral: true });
        } catch (e) {}
    }
});

// ========== Startup ==========
client.once('ready', async () => {
    console.log('NexaKS bot logged in as ' + client.user.tag);
    global.botStatus = 'online (' + client.user.tag + ')';
    await registerCommands();
});

client.on('error', (err) => {
    console.error('Discord client error:', err);
    global.botStatus = 'error: ' + err.message;
});

client.login(BOT_TOKEN).catch(err => {
    console.error('Login failed:', err.message);
    global.botStatus = 'login failed: ' + err.message;
});
