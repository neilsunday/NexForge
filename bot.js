/* ========================================
   NexaKS Discord Bot - Panel Edition
   Slash commands + interactive button panel
   ======================================== */

const {
    Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes,
    EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// ========== Config ==========
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const VERIFIED_ROLE_ID = process.env.DISCORD_VERIFIED_ROLE_ID;
const ADMIN_ROLE_ID = process.env.DISCORD_ADMIN_ROLE_ID;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL = process.env.SITE_URL || 'https://keyora-gyuu.onrender.com';

if (!BOT_TOKEN || !CLIENT_ID) {
    console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID');
    global.botStatus = 'error: missing config';
    return;
}

if (!SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_SERVICE_KEY');
    global.botStatus = 'error: missing service key';
    return;
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ========== Commands ==========
const commands = [
    new SlashCommandBuilder()
        .setName('setup-panel')
        .setDescription('[Admin] Post the NexaKS interactive panel in this channel'),

    new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Redeem a NexaKS license key')
        .addStringOption(opt => opt.setName('key').setDescription('Your license key').setRequired(true)),

    new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset your hardware ID (24h cooldown)'),

    new SlashCommandBuilder()
        .setName('keyinfo')
        .setDescription('View your active license details'),

    new SlashCommandBuilder()
        .setName('generate')
        .setDescription('[Admin] Generate license keys')
        .addStringOption(opt => opt.setName('plan').setDescription('Plan').setRequired(true)
            .addChoices({name:'Free',value:'free'},{name:'Pro',value:'pro'},{name:'Enterprise',value:'enterprise'}))
        .addStringOption(opt => opt.setName('duration').setDescription('Duration').setRequired(true)
            .addChoices({name:'1 day',value:'1'},{name:'7 days',value:'7'},{name:'30 days',value:'30'},
                {name:'90 days',value:'90'},{name:'1 year',value:'365'},{name:'Lifetime',value:'lifetime'}))
        .addIntegerOption(opt => opt.setName('quantity').setDescription('Quantity').setMinValue(1).setMaxValue(50)),

    new SlashCommandBuilder()
        .setName('revoke')
        .setDescription('[Admin] Revoke a license key')
        .addStringOption(opt => opt.setName('key').setDescription('Key to revoke').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('[Admin] Look up a user')
        .addUserOption(opt => opt.setName('user').setDescription('Discord user').setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
            console.log('Registered commands for guild ' + GUILD_ID);
        } else {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('Registered global commands');
        }
    } catch (err) {
        console.error('Command registration failed:', err);
    }
}

// ========== Helpers ==========
function embed(title, description, color) {
    return new EmbedBuilder()
        .setColor(color || 0x7c3aed)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: 'NexaKS' })
        .setTimestamp();
}

async function isAdmin(interaction) {
    const { data: user } = await sb.from('users')
        .select('is_admin').eq('discord_id', interaction.user.id).maybeSingle();
    if (user?.is_admin) return true;
    if (ADMIN_ROLE_ID && interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID)) return true;
    return false;
}

async function ensureUserRow(discordUser) {
    const { data: existing } = await sb.from('users')
        .select('*').eq('discord_id', discordUser.id).maybeSingle();
    if (existing) return existing;

    const { data: created, error } = await sb.from('users').insert({
        id: require('crypto').randomUUID(),
        discord_id: discordUser.id,
        username: discordUser.username || discordUser.globalName || 'User',
        avatar_url: discordUser.displayAvatarURL ? discordUser.displayAvatarURL() : null
    }).select().single();

    if (error) { console.error('Create user row:', error); return null; }
    return created;
}

async function assignVerifiedRole(interaction) {
    if (!VERIFIED_ROLE_ID || !interaction.member) return false;
    try {
        await interaction.member.roles.add(VERIFIED_ROLE_ID);
        await sb.from('users').update({ discord_role_assigned: true })
            .eq('discord_id', interaction.user.id);
        return true;
    } catch (err) {
        console.warn('Role assign failed:', err.message);
        return false;
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

// ========== Panel builder ==========
function buildPanel() {
    const panelEmbed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle('NexaKS Script Portal')
        .setDescription(
            'Welcome to **NexaKS** â€” enterprise-grade script authentication.\n\n' +
            'Click the buttons below to manage your license:\n\n' +
            '**Redeem Key** - Activate your license\n' +
            '**Get Script** - Receive your personalized loader\n' +
            '**Reset HWID** - Change device (24h cooldown)\n' +
            '**Get Stats** - View your license details\n' +
            '**Get Role** - Claim your Verified role\n\n' +
            '**Warning:** Sharing your key or loader script may result in permanent revocation and ban.'
        )
        .setFooter({ text: 'NexaKS | HWID-locked authentication' })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_redeem').setLabel('Redeem Key').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('panel_script').setLabel('Get Script').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_role').setLabel('Get Role').setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_reset').setLabel('Reset HWID').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_stats').setLabel('Get Stats').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setLabel('Open Dashboard').setStyle(ButtonStyle.Link).setURL(SITE_URL + '/dashboard')
    );

    return { embeds: [panelEmbed], components: [row1, row2] };
}

// ========== Interaction handler ==========
client.on('interactionCreate', async (interaction) => {
    try {
        // ============ SLASH COMMANDS ============
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;

            // /setup-panel (admin only)
            if (cmd === 'setup-panel') {
                if (!(await isAdmin(interaction))) {
                    return interaction.reply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)], ephemeral: true });
                }
                await interaction.reply({ content: 'Panel posted.', ephemeral: true });
                await interaction.channel.send(buildPanel());
                return;
            }

            // /redeem (traditional slash)
            if (cmd === 'redeem') {
                await interaction.deferReply({ ephemeral: true });
                const key = interaction.options.getString('key').trim().toUpperCase();
                return handleRedeem(interaction, key);
            }

            // /resethwid
            if (cmd === 'resethwid') {
                await interaction.deferReply({ ephemeral: true });
                return handleResetHwid(interaction);
            }

            // /keyinfo
            if (cmd === 'keyinfo') {
                await interaction.deferReply({ ephemeral: true });
                return handleKeyInfo(interaction);
            }

            // /generate (admin)
            if (cmd === 'generate') {
                await interaction.deferReply({ ephemeral: true });
                if (!(await isAdmin(interaction))) {
                    return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
                }
                const plan = interaction.options.getString('plan');
                const duration = interaction.options.getString('duration');
                const qty = interaction.options.getInteger('quantity') || 1;
                return handleGenerate(interaction, plan, duration, qty);
            }

            // /revoke (admin)
            if (cmd === 'revoke') {
                await interaction.deferReply({ ephemeral: true });
                if (!(await isAdmin(interaction))) {
                    return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
                }
                const key = interaction.options.getString('key').trim().toUpperCase();
                return handleRevoke(interaction, key);
            }

            // /lookup (admin)
            if (cmd === 'lookup') {
                await interaction.deferReply({ ephemeral: true });
                if (!(await isAdmin(interaction))) {
                    return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
                }
                const targetUser = interaction.options.getUser('user');
                return handleLookup(interaction, targetUser);
            }
        }

        // ============ BUTTON CLICKS ============
        if (interaction.isButton()) {
            const id = interaction.customId;

            // Show modal for Redeem
            if (id === 'panel_redeem') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_redeem')
                    .setTitle('Redeem License Key');
                const input = new TextInputBuilder()
                    .setCustomId('key_input')
                    .setLabel('License Key')
                    .setPlaceholder('NXKS-XXXX-XXXX-XXXX-XXXX')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(24)
                    .setMaxLength(24);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);
            }

            // Get Script button
            if (id === 'panel_script') {
                await interaction.deferReply({ ephemeral: true });
                return handleGetScript(interaction);
            }

            // Get Role button
            if (id === 'panel_role') {
                await interaction.deferReply({ ephemeral: true });
                return handleGetRole(interaction);
            }

            // Reset HWID button - show confirm
            if (id === 'panel_reset') {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_reset').setLabel('Yes, Reset').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({
                    embeds: [embed('Confirm Reset',
                        'This will unlink your license from the current device.\n' +
                        '**Cooldown:** 24 hours between resets.\n' +
                        '**Limit:** 5 resets total per key.', 0xf59e0b)],
                    components: [confirmRow],
                    ephemeral: true
                });
            }

            // Reset confirmed
            if (id === 'confirm_reset') {
                await interaction.deferUpdate();
                await handleResetHwid(interaction, true);
                return;
            }

            if (id === 'cancel_reset') {
                return interaction.update({
                    embeds: [embed('Cancelled', 'HWID reset cancelled.', 0x6b7280)],
                    components: []
                });
            }

            // Get Stats button
            if (id === 'panel_stats') {
                await interaction.deferReply({ ephemeral: true });
                return handleKeyInfo(interaction);
            }
        }

        // ============ MODAL SUBMISSIONS ============
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_redeem') {
                await interaction.deferReply({ ephemeral: true });
                const key = interaction.fields.getTextInputValue('key_input').trim().toUpperCase();
                return handleRedeem(interaction, key);
            }
        }

    } catch (err) {
        console.error('Interaction error:', err);
        try {
            const msg = { embeds: [embed('Error', 'Something went wrong: ' + err.message, 0xef4444)], ephemeral: true };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(msg).catch(() => {});
            } else {
                await interaction.reply(msg).catch(() => {});
            }
        } catch (e) {}
    }
});

// ========== Handler functions ==========

async function handleRedeem(interaction, key) {
    if (!key.startsWith('NXKS-')) {
        return interaction.editReply({ embeds: [embed('Invalid Format', 'Keys start with `NXKS-`', 0xef4444)] });
    }

    const user = await ensureUserRow(interaction.user);
    if (!user) return interaction.editReply({ embeds: [embed('Error', 'Could not create profile.', 0xef4444)] });

    const { data: existing } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
    if (!existing) return interaction.editReply({ embeds: [embed('Not Found', 'License key does not exist.', 0xef4444)] });
    if (existing.status === 'revoked') return interaction.editReply({ embeds: [embed('Revoked', 'This key has been revoked.', 0xef4444)] });
    if (existing.user_id && existing.user_id !== user.id) {
        return interaction.editReply({ embeds: [embed('Already Claimed', 'This key is bound to another user.', 0xef4444)] });
    }

    const updates = { user_id: user.id, status: 'active', redeemed_via: 'discord' };
    if (existing.duration_days && !existing.expires_at) {
        const exp = new Date();
        exp.setDate(exp.getDate() + existing.duration_days);
        updates.expires_at = exp.toISOString();
    }

    const { error } = await sb.from('keys').update(updates).eq('key', key);
    if (error) return interaction.editReply({ embeds: [embed('Error', 'Redeem failed: ' + error.message, 0xef4444)] });

    await sb.from('logs').insert({
        user_id: user.id, key: key,
        action: 'redeem', status: 'success',
        metadata: { message: 'Redeemed via Discord', source: 'discord' }
    });

    // Auto-assign Verified role
    const roleAssigned = await assignVerifiedRole(interaction);

    const expText = updates.expires_at
        ? new Date(updates.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'Lifetime';

    return interaction.editReply({
        embeds: [embed('License Activated',
            '**Plan:** ' + existing.plan.toUpperCase() + '\n' +
            '**Expires:** ' + expText + '\n' +
            '**Key:** `' + key + '`\n\n' +
            (roleAssigned ? 'Verified role assigned.\n' : '') +
            'Click **Get Script** to receive your loader.', 0x10b981)]
    });
}

async function handleGetScript(interaction) {
    const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first with the **Redeem Key** button.', 0xef4444)] });

    const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!key) return interaction.editReply({ embeds: [embed('No Active License', 'You have no active license. Redeem one first.', 0xef4444)] });

    const loader = [
        '-- NexaKS Authentication Loader',
        'local license = "' + key.key + '"',
        'local hwid = game:GetService("RbxAnalyticsService"):GetClientId()',
        'local url = "' + SITE_URL + '/api/verify?license=" .. license .. "&hwid=" .. hwid',
        '',
        'local ok, response = pcall(function() return game:HttpGet(url, true) end)',
        'if not ok then warn("[NexaKS] Network error: " .. tostring(response)) return end',
        'if not response or response == "" then warn("[NexaKS] Empty response from server") return end',
        '',
        'local success, err = pcall(function() loadstring(response)() end)',
        'if not success then warn("[NexaKS] " .. tostring(err)) end'
    ].join('\n');

    // Try DM
    try {
        await interaction.user.send({
            embeds: [embed('Your NexaKS Loader',
                'Paste this into your Roblox executor:\n\n```lua\n' + loader + '\n```\n\n' +
                '**Warning:** Do not share this loader â€” it contains your personal key. Sharing = ban.',
                0x7c3aed)]
        });
        return interaction.editReply({ embeds: [embed('Sent via DM', 'Check your direct messages for the loader script.', 0x10b981)] });
    } catch (err) {
        // DMs closed - reply ephemerally
        return interaction.editReply({
            embeds: [embed('Your Loader (DMs closed)',
                'Copy this loader:\n\n```lua\n' + loader + '\n```\n\n' +
                'For future privacy, enable DMs from server members.', 0x7c3aed)]
        });
    }
}

async function handleGetRole(interaction) {
    if (!VERIFIED_ROLE_ID) {
        return interaction.editReply({ embeds: [embed('Not Configured', 'Verified role is not configured on this server.', 0xf59e0b)] });
    }

    const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first.', 0xef4444)] });

    const { data: key } = await sb.from('keys').select('key').eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!key) return interaction.editReply({ embeds: [embed('No Active License', 'Need an active license to get the role.', 0xef4444)] });

    if (interaction.member?.roles?.cache?.has(VERIFIED_ROLE_ID)) {
        return interaction.editReply({ embeds: [embed('Already Verified', 'You already have the role.', 0x10b981)] });
    }

    const success = await assignVerifiedRole(interaction);
    if (success) {
        return interaction.editReply({ embeds: [embed('Role Assigned', 'You now have the Verified role.', 0x10b981)] });
    } else {
        return interaction.editReply({ embeds: [embed('Failed', 'Could not assign role. Bot may lack permission.', 0xef4444)] });
    }
}

async function handleResetHwid(interaction, fromButton) {
    const reply = fromButton ? 'editReply' : 'editReply';
    const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
    if (!user) {
        const msg = { embeds: [embed('No Account', 'Redeem a key first.', 0xef4444)], components: [] };
        return fromButton ? interaction.editReply(msg) : interaction.editReply(msg);
    }

    const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!key) {
        const msg = { embeds: [embed('No Active License', 'You have no active license.', 0xef4444)], components: [] };
        return fromButton ? interaction.editReply(msg) : interaction.editReply(msg);
    }

    if (key.last_hwid_reset) {
        const hrs = (new Date() - new Date(key.last_hwid_reset)) / 3600000;
        if (hrs < 24) {
            const msg = { embeds: [embed('Cooldown Active', 'Wait **' + Math.ceil(24 - hrs) + ' hours** before resetting.', 0xf59e0b)], components: [] };
            return fromButton ? interaction.editReply(msg) : interaction.editReply(msg);
        }
    }

    if ((key.hwid_reset_count || 0) >= (key.hwid_reset_limit || 5)) {
        const msg = { embeds: [embed('Limit Reached', 'Used all ' + (key.hwid_reset_limit || 5) + ' resets. Contact admin.', 0xef4444)], components: [] };
        return fromButton ? interaction.editReply(msg) : interaction.editReply(msg);
    }

    const { error } = await sb.from('keys').update({
        hwid: null,
        hwid_reset_count: (key.hwid_reset_count || 0) + 1,
        last_hwid_reset: new Date().toISOString()
    }).eq('key', key.key);

    if (error) {
        const msg = { embeds: [embed('Error', error.message, 0xef4444)], components: [] };
        return fromButton ? interaction.editReply(msg) : interaction.editReply(msg);
    }

    await sb.from('logs').insert({
        user_id: user.id, key: key.key,
        action: 'reset_hwid', status: 'success',
        metadata: { message: 'HWID reset via Discord', source: 'discord' }
    });

    const remaining = (key.hwid_reset_limit || 5) - (key.hwid_reset_count + 1);
    const msg = {
        embeds: [embed('HWID Reset', 'Hardware ID cleared. Run your script again to bind a new device.\n\n**Resets remaining:** ' + remaining, 0x10b981)],
        components: []
    };
    return fromButton ? interaction.editReply(msg) : interaction.editReply(msg);
}

async function handleKeyInfo(interaction) {
    const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first.', 0xef4444)] });

    const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!key) return interaction.editReply({ embeds: [embed('No Active License', 'You have no active license.', 0xef4444)] });

    const expText = key.expires_at
        ? new Date(key.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Lifetime';
    const hwidText = key.hwid ? '`' + key.hwid.substring(0, 12) + '...`' : 'Not bound yet';

    return interaction.editReply({ embeds: [embed('Your License',
        '**Key:** `' + key.key + '`\n' +
        '**Plan:** ' + key.plan.toUpperCase() + '\n' +
        '**Status:** ' + key.status + '\n' +
        '**Expires:** ' + expText + '\n' +
        '**Hardware ID:** ' + hwidText + '\n' +
        '**HWID Resets:** ' + (key.hwid_reset_count || 0) + '/' + (key.hwid_reset_limit || 5) + '\n' +
        '**Executions:** ' + (key.execution_count || 0), 0x7c3aed)] });
}

async function handleGenerate(interaction, plan, duration, qty) {
    const user = await ensureUserRow(interaction.user);
    const keys = [];
    const rows = [];
    for (let i = 0; i < qty; i++) {
        const k = generateKeyString();
        keys.push(k);
        rows.push({
            key: k, plan: plan,
            duration_days: duration === 'lifetime' ? null : parseInt(duration),
            hwid_reset_limit: 5, status: 'unclaimed',
            created_by: user?.id
        });
    }

    const { error } = await sb.from('keys').insert(rows);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    await sb.from('logs').insert({
        user_id: user?.id, action: 'admin_generate', status: 'success',
        metadata: { message: 'Generated ' + qty + ' ' + plan + ' keys via bot (' + duration + ')' }
    });

    return interaction.editReply({ embeds: [embed('Keys Generated',
        'Generated **' + qty + '** ' + plan.toUpperCase() + ' keys (' + duration + ')\n\n' +
        keys.map(k => '`' + k + '`').join('\n') + '\n\n*Save these â€” hindi na uulit yung display.*', 0x10b981)] });
}

async function handleRevoke(interaction, key) {
    const { data: existing } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
    if (!existing) return interaction.editReply({ embeds: [embed('Not Found', 'Key does not exist.', 0xef4444)] });

    const { error } = await sb.from('keys').update({ status: 'revoked' }).eq('key', key);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    const admin = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: admin?.id, key: key,
        action: 'admin_revoke', status: 'success',
        metadata: { message: 'Revoked via Discord by ' + interaction.user.username }
    });

    return interaction.editReply({ embeds: [embed('Key Revoked', '`' + key + '` revoked. User loses access immediately.', 0x10b981)] });
}

async function handleLookup(interaction, targetUser) {
    const { data: user } = await sb.from('users').select('*').eq('discord_id', targetUser.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('Not Registered', targetUser.username + ' has not signed in yet.', 0xf59e0b)] });

    const { data: keys } = await sb.from('keys').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    const active = (keys || []).filter(k => k.status === 'active');
    const revoked = (keys || []).filter(k => k.status === 'revoked');

    const keySummary = active.length > 0
        ? active.map(k => '`' + k.key + '` - ' + k.plan.toUpperCase() +
            (k.expires_at ? ' (expires ' + new Date(k.expires_at).toLocaleDateString() + ')' : ' (lifetime)')).join('\n')
        : 'No active keys';

    return interaction.editReply({ embeds: [embed('User: ' + (user.username || targetUser.username),
        '**Discord ID:** ' + targetUser.id + '\n' +
        '**Joined:** ' + new Date(user.created_at).toLocaleDateString() + '\n' +
        '**Admin:** ' + (user.is_admin ? 'Yes' : 'No') + '\n' +
        '**Banned:** ' + (user.is_banned ? 'Yes' : 'No') + '\n' +
        '**Total keys:** ' + (keys?.length || 0) + ' (' + active.length + ' active, ' + revoked.length + ' revoked)\n\n' +
        '**Active Keys:**\n' + keySummary, 0x7c3aed)] });
}

// ========== Startup ==========
client.once('clientReady', async () => {
    console.log('NexaKS bot logged in as ' + client.user.tag);
    global.botStatus = 'online (' + client.user.tag + ')';
    await registerCommands();
});

client.on('error', (err) => {
    console.error('Discord error:', err);
    global.botStatus = 'error: ' + err.message;
});

client.login(BOT_TOKEN).catch(err => {
    console.error('Login failed:', err.message);
    global.botStatus = 'login failed: ' + err.message;
});
