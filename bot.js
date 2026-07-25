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
const OWNER_ROLE_ID = process.env.DISCORD_OWNER_ROLE_ID;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL = process.env.SITE_URL || 'https://keyora-gyuu.onrender.com';

// Project slug -> Discord role ID mapping (hardcoded)
const PROJECT_ROLE_MAP = {
    macro:   '1530196461730533556',
    premium: '1530196527740358697',
    private: '1530196626503897138'
};

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
    // ---- panel bootstrap (kept from original) ----
    new SlashCommandBuilder()
        .setName('setup-panel')
        .setDescription('[Admin] Post the NexaKS interactive panel in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('project').setDescription('Project slug (ties panel to one project)').setRequired(false)),

    // ========== USER COMMANDS ==========
    new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Redeem a key')
        .addStringOption(opt => opt.setName('key').setDescription('Your license key').setRequired(true)),

    new SlashCommandBuilder()
        .setName('loader')
        .setDescription('Get your loader script'),

    new SlashCommandBuilder()
        .setName('script')
        .setDescription('Get the latest script'),

    new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset your HWID (every 15 hours)'),

    new SlashCommandBuilder()
        .setName('claimrole')
        .setDescription('Claim your buyer role'),

    new SlashCommandBuilder()
        .setName('key')
        .setDescription('Manage license keys')
        // ---- user-facing subcommand ----
        .addSubcommand(sc => sc.setName('view').setDescription('View your redeemed key'))
        // ---- admin subcommands ----
        .addSubcommand(sc => sc.setName('create').setDescription('[Admin] Generate a key')
            .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
                .addChoices({name:'Free',value:'free'},{name:'Pro',value:'pro'},{name:'Enterprise',value:'enterprise'}))
            .addStringOption(o => o.setName('duration').setDescription('Duration').setRequired(true)
                .addChoices({name:'1 day',value:'1'},{name:'7 days',value:'7'},{name:'30 days',value:'30'},
                    {name:'90 days',value:'90'},{name:'1 year',value:'365'},{name:'Lifetime',value:'lifetime'}))
            .addIntegerOption(o => o.setName('quantity').setDescription('Quantity').setMinValue(1).setMaxValue(50))
            .addStringOption(o => o.setName('project').setDescription('Project slug').setRequired(false)))
        .addSubcommand(sc => sc.setName('delete').setDescription('[Admin] Delete a key')
            .addStringOption(o => o.setName('key').setDescription('Key to delete').setRequired(true)))
        .addSubcommand(sc => sc.setName('extend').setDescription('[Admin] Extend a key')
            .addStringOption(o => o.setName('key').setDescription('Key to extend').setRequired(true))
            .addIntegerOption(o => o.setName('days').setDescription('Additional days').setRequired(true).setMinValue(1).setMaxValue(3650)))
        .addSubcommand(sc => sc.setName('revoke').setDescription('[Admin] Revoke a key')
            .addStringOption(o => o.setName('key').setDescription('Key to revoke').setRequired(true)))
        .addSubcommand(sc => sc.setName('info').setDescription('[Admin] View key information')
            .addStringOption(o => o.setName('key').setDescription('Key to inspect').setRequired(true))),

    new SlashCommandBuilder()
        .setName('project')
        .setDescription('Project commands')
        // ---- user-facing subcommand ----
        .addSubcommand(sc => sc.setName('view').setDescription('View your current project'))
        // ---- admin subcommands ----
        .addSubcommand(sc => sc.setName('create').setDescription('[Admin] Create a project')
            .addStringOption(o => o.setName('slug').setDescription('Project slug (lowercase, no spaces)').setRequired(true))
            .addStringOption(o => o.setName('name').setDescription('Display name').setRequired(true)))
        .addSubcommand(sc => sc.setName('delete').setDescription('[Admin] Delete a project')
            .addStringOption(o => o.setName('slug').setDescription('Project slug').setRequired(true)))
        .addSubcommand(sc => sc.setName('list').setDescription('[Admin] View all projects')),

    new SlashCommandBuilder()
        .setName('subscription')
        .setDescription('Check your plan'),

    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your account information'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all commands'),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check service status'),

    // ========== ADMIN COMMANDS ==========
    new SlashCommandBuilder()
        .setName('user')
        .setDescription('[Admin] User management')
        .addSubcommand(sc => sc.setName('info').setDescription('View user information')
            .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)))
        .addSubcommand(sc => sc.setName('blacklist').setDescription('Blacklist a user')
            .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)))
        .addSubcommand(sc => sc.setName('unblacklist').setDescription('Remove blacklist')
            .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))),

    new SlashCommandBuilder()
        .setName('hwid')
        .setDescription('[Admin] HWID management')
        .addSubcommand(sc => sc.setName('reset').setDescription('Force reset HWID')
            .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))),
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

function isOwner(interaction) {
    if (!OWNER_ROLE_ID || !interaction.member?.roles?.cache) return false;
    return interaction.member.roles.cache.has(OWNER_ROLE_ID);
}

async function ensureUserRow(discordUser) {
    // 1. Look up by discord_id first (fast path for existing users)
    const { data: existingByDiscord } = await sb.from('users')
        .select('*').eq('discord_id', discordUser.id).maybeSingle();
    if (existingByDiscord) return existingByDiscord;

    // 2. Try to find a web-side row that hasn't been linked to Discord yet.
    // Supabase Auth stores the Discord user id under raw_user_meta_data.provider_id
    // when a user signs in with the Discord OAuth provider. If we find a match,
    // reuse that row and stamp the discord_id onto it.
    try {
        const { data: authList } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const authUser = authList?.users?.find(u => {
            const meta = u.user_metadata || u.raw_user_meta_data || {};
            return meta.provider_id === discordUser.id || meta.sub === discordUser.id;
        });
        if (authUser) {
            // Row may already exist keyed by the auth id - just add discord_id + return
            const { data: rowById } = await sb.from('users')
                .select('*').eq('id', authUser.id).maybeSingle();
            if (rowById) {
                if (!rowById.discord_id) {
                    await sb.from('users').update({
                        discord_id: discordUser.id,
                        username: rowById.username || discordUser.username || discordUser.globalName || 'User',
                        avatar_url: rowById.avatar_url || (discordUser.displayAvatarURL ? discordUser.displayAvatarURL() : null)
                    }).eq('id', authUser.id);
                }
                return { ...rowById, discord_id: discordUser.id };
            }
            // Auth user exists but no profile row yet - create one using the auth id
            const { data: linked, error: linkErr } = await sb.from('users').insert({
                id: authUser.id,
                discord_id: discordUser.id,
                username: discordUser.username || discordUser.globalName || 'User',
                avatar_url: discordUser.displayAvatarURL ? discordUser.displayAvatarURL() : null
            }).select().single();
            if (!linkErr && linked) return linked;
            console.error('Link-to-auth insert failed:', linkErr);
        }
    } catch (e) {
        // listUsers may fail (permissions, network) - fall through to plain insert
        console.warn('Auth link lookup skipped:', e.message);
    }

    // 3. Plain insert for Discord-first users (requires users_id_fkey to be dropped)
    const { data: created, error } = await sb.from('users').insert({
        id: require('crypto').randomUUID(),
        discord_id: discordUser.id,
        username: discordUser.username || discordUser.globalName || 'User',
        avatar_url: discordUser.displayAvatarURL ? discordUser.displayAvatarURL() : null
    }).select().single();

    if (error) {
        console.error('Create user row:', error);
        // Attach the error message so callers can surface it in the reply
        const err = new Error(error.message || 'Insert failed');
        err.pgCode = error.code;
        err.pgDetails = error.details;
        throw err;
    }
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

// Assign a project-specific role (macro / private / premium) to a member.
// Accepts either the interaction (uses interaction.member) or a fetched GuildMember object.
async function assignProjectRole(memberOrInteraction, projectSlug) {
    if (!projectSlug) return { ok: false, reason: 'no_project' };
    const slug = String(projectSlug).toLowerCase();
    const roleId = PROJECT_ROLE_MAP[slug];
    if (!roleId) return { ok: false, reason: 'no_role_configured', slug };

    const member = memberOrInteraction?.member || memberOrInteraction;
    if (!member || !member.roles || typeof member.roles.add !== 'function') {
        return { ok: false, reason: 'no_member' };
    }

    try {
        await member.roles.add(roleId);
        return { ok: true, slug, roleId };
    } catch (err) {
        console.warn('Project role assign failed (' + slug + '):', err.message);
        return { ok: false, reason: 'discord_error', error: err.message };
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
function buildPanel(project) {
    // Project slug still routes the Get Script button, hidden from the embed text.
    const scriptBtnId = project ? ('panel_script:' + project.slug) : 'panel_script';
    // Dynamic header - uses the project's display name, falls back if unattached.
    const headerName = project ? project.name : 'Nexa Key Project';
    const panelEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription(
            '# ' + headerName + '\n' +
            'Redeem your key, claim your buyer role, or get your script loader from this panel.\n\n' +
            '**HWID resets** are limited to once every **15 hours** - First reset becomes available 15 hours after redeeming your key.\n\n' +
            '**Warning:** Sharing your key or loader script may result in the loss of your key or a permanent ban.'
        )
        .setFooter({ text: 'Nexa Team' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_redeem').setLabel('Redeem Key').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('panel_role').setLabel('Get Role').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(scriptBtnId).setLabel('Get Script').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_reset').setLabel('Reset HWID').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('panel_stats').setLabel('Session Status').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [panelEmbed], components: [row1, row2] };
}

// ========== Interaction handler ==========
client.on('interactionCreate', async (interaction) => {
    try {
        // ============ SLASH COMMANDS ============
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;
            const sub = interaction.options.getSubcommand(false);

            // /setup-panel (admin only)
            if (cmd === 'setup-panel') {
                if (!(await isAdmin(interaction))) {
                    return interaction.reply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)], ephemeral: true });
                }
                const slug = interaction.options.getString('project');
                let panelProject = null;
                if (slug) {
                    const { data } = await sb.from('projects').select('*').eq('slug', slug.trim().toLowerCase()).maybeSingle();
                    if (!data) return interaction.reply({ embeds: [embed('Not Found', 'No project with slug \`' + slug + '\`', 0xef4444)], ephemeral: true });
                    panelProject = data;
                }
                await interaction.reply({ content: 'Panel posted.', ephemeral: true });
                await interaction.channel.send(buildPanel(panelProject));
                return;
            }

            // ---------- USER COMMANDS ----------
            if (cmd === 'redeem') {
                await interaction.deferReply({ ephemeral: true });
                const key = interaction.options.getString('key').trim().toUpperCase();
                return handleRedeem(interaction, key);
            }

            if (cmd === 'loader') {
                await interaction.deferReply({ ephemeral: true });
                return handleGetScript(interaction, null);
            }

            if (cmd === 'script') {
                await interaction.deferReply({ ephemeral: true });
                return handleGetScript(interaction, null);
            }

            if (cmd === 'resethwid') {
                await interaction.deferReply({ ephemeral: true });
                return handleResetHwid(interaction);
            }

            if (cmd === 'claimrole') {
                await interaction.deferReply({ ephemeral: true });
                return handleGetRole(interaction);
            }

            if (cmd === 'subscription') {
                await interaction.deferReply({ ephemeral: true });
                return handleSubscription(interaction);
            }

            if (cmd === 'profile') {
                await interaction.deferReply({ ephemeral: true });
                return handleProfile(interaction);
            }

            if (cmd === 'help') {
                await interaction.deferReply({ ephemeral: true });
                return handleHelp(interaction);
            }

            if (cmd === 'status') {
                await interaction.deferReply({ ephemeral: true });
                return handleStatus(interaction);
            }

            // ---------- /key group ----------
            if (cmd === 'key') {
                await interaction.deferReply({ ephemeral: true });

                if (sub === 'view') {
                    return handleKeyInfo(interaction); // user's own key
                }

                // remaining subcommands are admin-only
                if (!(await isAdmin(interaction))) {
                    return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
                }

                if (sub === 'create') {
                    const plan = interaction.options.getString('plan');
                    const duration = interaction.options.getString('duration');
                    const qty = interaction.options.getInteger('quantity') || 1;
                    const projSlug = interaction.options.getString('project');
                    return handleGenerate(interaction, plan, duration, qty, projSlug);
                }
                if (sub === 'delete') {
                    const key = interaction.options.getString('key').trim().toUpperCase();
                    return handleKeyDelete(interaction, key);
                }
                if (sub === 'extend') {
                    const key = interaction.options.getString('key').trim().toUpperCase();
                    const days = interaction.options.getInteger('days');
                    return handleKeyExtend(interaction, key, days);
                }
                if (sub === 'revoke') {
                    const key = interaction.options.getString('key').trim().toUpperCase();
                    return handleRevoke(interaction, key);
                }
                if (sub === 'info') {
                    const key = interaction.options.getString('key').trim().toUpperCase();
                    return handleKeyLookup(interaction, key);
                }
            }

            // ---------- /project group ----------
            if (cmd === 'project') {
                await interaction.deferReply({ ephemeral: true });

                if (sub === 'view') {
                    return handleProjectView(interaction);
                }

                if (!(await isAdmin(interaction))) {
                    return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
                }

                if (sub === 'create') {
                    const slug = interaction.options.getString('slug');
                    const name = interaction.options.getString('name');
                    return handleProjectCreate(interaction, slug, name);
                }
                if (sub === 'delete') {
                    const slug = interaction.options.getString('slug');
                    return handleProjectDelete(interaction, slug);
                }
                if (sub === 'list') {
                    return handleProjectList(interaction);
                }
            }

            // ---------- /user group (admin) ----------
            if (cmd === 'user') {
                await interaction.deferReply({ ephemeral: true });
                if (!(await isAdmin(interaction))) {
                    return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
                }
                const targetUser = interaction.options.getUser('user');

                if (sub === 'info') {
                    return handleLookup(interaction, targetUser);
                }
                if (sub === 'blacklist') {
                    const reason = interaction.options.getString('reason') || 'No reason provided';
                    return handleBlacklist(interaction, targetUser, reason);
                }
                if (sub === 'unblacklist') {
                    return handleUnblacklist(interaction, targetUser);
                }
            }

            // ---------- /hwid group (admin) ----------
            if (cmd === 'hwid') {
                await interaction.deferReply({ ephemeral: true });
                if (!(await isAdmin(interaction))) {
                    return interaction.editReply({ embeds: [embed('Access Denied', 'Admin only.', 0xef4444)] });
                }
                if (sub === 'reset') {
                    const targetUser = interaction.options.getUser('user');
                    return handleForceReset(interaction, targetUser);
                }
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

            // Get Script button (may carry :slug for a project)
            if (id === 'panel_script' || id.startsWith('panel_script:')) {
                await interaction.deferReply({ ephemeral: true });
                const slug = id.includes(':') ? id.split(':')[1] : null;
                return handleGetScript(interaction, slug);
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
                        '**Cooldown:** 15 hours between resets.\n' +
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

    let user;
    try {
        user = await ensureUserRow(interaction.user);
    } catch (err) {
        return interaction.editReply({ embeds: [embed('Profile Error',
            'Could not create your profile.\n\n' +
            '**Reason:** ' + (err.message || 'Unknown error') + '\n' +
            (err.pgCode ? '**Code:** `' + err.pgCode + '`\n' : '') +
            '\nContact an admin if this keeps happening.', 0xef4444)] });
    }
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

    // Auto-assign project role (macro / private / premium) based on the key's project
    let projectRoleLine = '';
    if (existing.project_id) {
        const { data: proj } = await sb.from('projects').select('slug, name').eq('id', existing.project_id).maybeSingle();
        if (proj && proj.slug) {
            const result = await assignProjectRole(interaction, proj.slug);
            if (result.ok) {
                projectRoleLine = '**' + proj.slug.charAt(0).toUpperCase() + proj.slug.slice(1) + '** role assigned.\n';
            } else if (result.reason === 'no_role_configured') {
                projectRoleLine = 'No role configured for project `' + proj.slug + '`.\n';
            }
        }
    }

    const expText = updates.expires_at
        ? new Date(updates.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'Lifetime';

    return interaction.editReply({
        embeds: [embed('License Activated',
            '**Plan:** ' + existing.plan.toUpperCase() + '\n' +
            '**Expires:** ' + expText + '\n' +
            '**Key:** `' + key + '`\n\n' +
            (roleAssigned ? 'Verified role assigned.\n' : '') +
            projectRoleLine +
            'Click **Get Script** to receive your loader.', 0x10b981)]
    });
}

async function handleGetScript(interaction, projectSlug) {
    const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first with the **Redeem Key** button.', 0xef4444)] });

    const { data: keys } = await sb.from('keys').select('*')
        .eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: false });
    if (!keys || keys.length === 0) {
        return interaction.editReply({ embeds: [embed('No Active License', 'You have no active license. Redeem one first.', 0xef4444)] });
    }

    // ---- PANEL IS TIED TO A PROJECT ----
    if (projectSlug) {
        const { data: proj } = await sb.from('projects').select('*').eq('slug', projectSlug).maybeSingle();
        if (!proj) return interaction.editReply({ embeds: [embed('Not Found', 'Project no longer exists.', 0xef4444)] });

        // Require a key that belongs to THIS project
        const key = keys.find(k => k.project_id === proj.id);
        if (!key) {
            return interaction.editReply({ embeds: [embed('No ' + proj.name + ' License',
                'You do not have an active license for **' + proj.name + '**.\n\n' +
                'Your current key(s) belong to other projects. Purchase or redeem a **' + proj.name + '** key first.',
                0xef4444)] });
        }

        // Fetch published script for this project + plan
        const { data: scripts } = await sb.from('project_scripts')
            .select('*').eq('project_id', proj.id).eq('status', 'published')
            .order('updated_at', { ascending: false });
        if (!scripts || scripts.length === 0) {
            return interaction.editReply({ embeds: [embed('No Script Yet',
                'Project **' + proj.name + '** has no published script.', 0xf59e0b)] });
        }
        const script = scripts.find(s => s.plan === key.plan) || scripts.find(s => s.plan === 'free') || scripts[0];

        const base = SITE_URL + '/api/load/' + proj.slug + (script.load_id ? '?script=' + script.load_id : '');
        let loader;
        if (script.keyless) {
            loader = 'loadstring(game:HttpGet("' + base + '"))()';
        } else {
            const sep = base.includes('?') ? '&' : '?';
            loader = '_G.script_key = "' + key.key + '"\n' +
                'loadstring(game:HttpGet("' + base + sep + 'key=".._G.script_key))()';
        }
        return sendLoader(interaction, loader, !script.keyless);
    }

    // ---- GENERIC PANEL (no project) - use user's most recent key + its project ----
    const key = keys[0];
    let project = null;
    if (key.project_id) {
        const { data: proj } = await sb.from('projects').select('*').eq('id', key.project_id).maybeSingle();
        project = proj;
    }

    if (!project) {
        const loader = '_G.script_key = "' + key.key + '"\n' +
            'loadstring(game:HttpGet("' + SITE_URL + '/api/verify?license=".._G.script_key.."&hwid="..game:GetService("RbxAnalyticsService"):GetClientId()))()';
        return sendLoader(interaction, loader, true);
    }

    const { data: scripts } = await sb.from('project_scripts')
        .select('*').eq('project_id', project.id).eq('status', 'published')
        .order('updated_at', { ascending: false });
    if (!scripts || scripts.length === 0) {
        return interaction.editReply({ embeds: [embed('No Script Yet', 'Project **' + project.name + '** has no published script.', 0xf59e0b)] });
    }
    const script = scripts.find(s => s.plan === key.plan) || scripts.find(s => s.plan === 'free') || scripts[0];

    const base = SITE_URL + '/api/load/' + project.slug + (script.load_id ? '?script=' + script.load_id : '');
    let loader;
    if (script.keyless) {
        loader = 'loadstring(game:HttpGet("' + base + '"))()';
    } else {
        const sep = base.includes('?') ? '&' : '?';
        loader = '_G.script_key = "' + key.key + '"\n' +
            'loadstring(game:HttpGet("' + base + sep + 'key=".._G.script_key))()';
    }
    return sendLoader(interaction, loader, !script.keyless);
}

async function sendLoader(interaction, loader, hasKey) {
    const warn = hasKey
        ? '**Warning:** Do not share this loader - it contains your personal key. Sharing = ban.'
        : 'This is a keyless loader - safe to share within terms.';
    const codeBlock = '```lua\n' + loader + '\n```';
    try {
        await interaction.user.send({
            embeds: [embed('Your NexaKS Loader',
                'Paste this into your Roblox executor:\n\n' + codeBlock + '\n\n' + warn,
                0x7c3aed)]
        });
        return interaction.editReply({ embeds: [embed('Sent via DM', 'Check your direct messages for the loader script.', 0x10b981)] });
    } catch (err) {
        return interaction.editReply({
            embeds: [embed('Your Loader (DMs closed)',
                'Copy this loader:\n\n' + codeBlock + '\n\nEnable DMs from server members for privacy.',
                0x7c3aed)]
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
        if (hrs < 15) {
            const msg = { embeds: [embed('Cooldown Active', 'Wait **' + Math.ceil(15 - hrs) + ' hours** before resetting.', 0xf59e0b)], components: [] };
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

async function handleGenerate(interaction, plan, duration, qty, projSlug) {
    const user = await ensureUserRow(interaction.user);

    // Resolve project if slug provided
    let project = null;
    if (projSlug) {
        const { data: proj } = await sb.from('projects').select('id,name,slug')
            .eq('slug', projSlug.trim().toLowerCase()).maybeSingle();
        if (!proj) return interaction.editReply({ embeds: [embed('Project Not Found',
            'No project with slug \`' + projSlug + '\`. Create it on the website first.', 0xef4444)] });
        project = proj;
    }

    const keys = [];
    const rows = [];
    for (let i = 0; i < qty; i++) {
        const k = generateKeyString();
        keys.push(k);
        rows.push({
            key: k, plan: plan,
            duration_days: duration === 'lifetime' ? null : parseInt(duration),
            hwid_reset_limit: 5, status: 'unclaimed',
            created_by: user?.id,
            project_id: project ? project.id : null
        });
    }

    const { error } = await sb.from('keys').insert(rows);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    await sb.from('logs').insert({
        user_id: user?.id, action: 'admin_generate', status: 'success',
        metadata: { message: 'Generated ' + qty + ' ' + plan + ' keys' + (project ? ' for ' + project.slug : '') + ' via bot (' + duration + ')' }
    });

    const projLine = project ? '\n**Project:** ' + project.name + ' (\`' + project.slug + '\`)' : '\n**Project:** none (unattached)';
    return interaction.editReply({ embeds: [embed('Keys Generated',
        'Generated **' + qty + '** ' + plan.toUpperCase() + ' keys (' + duration + ')' + projLine + '\n\n' +
        keys.map(k => '\`' + k + '\`').join('\n') + '\n\n*Save these - they will not be shown again.*', 0x10b981)] });
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

async function handleSetRole(interaction, targetUser, projectSlug) {
    if (!PROJECT_ROLE_MAP[projectSlug]) {
        return interaction.editReply({ embeds: [embed('Not Configured',
            'No role ID configured for \`' + projectSlug + '\`.', 0xef4444)] });
    }

    // Fetch the guild member for the target user
    let targetMember;
    try {
        targetMember = await interaction.guild.members.fetch(targetUser.id);
    } catch (err) {
        return interaction.editReply({ embeds: [embed('Not Found',
            targetUser.username + ' is not a member of this server.', 0xef4444)] });
    }

    const result = await assignProjectRole(targetMember, projectSlug);
    if (!result.ok) {
        const msg = result.reason === 'discord_error'
            ? 'Discord rejected the role assignment: ' + result.error + '\n\nMake sure the bot role is above the target role in Server Settings > Roles.'
            : 'Failed: ' + result.reason;
        return interaction.editReply({ embeds: [embed('Assignment Failed', msg, 0xef4444)] });
    }

    // Log it
    const admin = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: admin?.id,
        action: 'admin_setrole', status: 'success',
        metadata: {
            message: 'Assigned ' + projectSlug + ' role to ' + targetUser.username + ' by ' + interaction.user.username,
            target_discord_id: targetUser.id,
            project: projectSlug
        }
    });

    return interaction.editReply({ embeds: [embed('Role Assigned',
        '<@' + targetUser.id + '> now has the **' + projectSlug.charAt(0).toUpperCase() + projectSlug.slice(1) + '** role.', 0x10b981)] });
}

async function handleForceReset(interaction, targetUser) {
    const { data: user } = await sb.from('users').select('*').eq('discord_id', targetUser.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('Not Found', targetUser.username + ' has no account.', 0xef4444)] });

    const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!key) return interaction.editReply({ embeds: [embed('No Active License', targetUser.username + ' has no active license.', 0xef4444)] });

    // Bypass cooldown AND reset the counter back to 0 (owner privilege)
    const { error } = await sb.from('keys').update({
        hwid: null,
        hwid_reset_count: 0,
        last_hwid_reset: new Date().toISOString()
    }).eq('key', key.key);

    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    const owner = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: owner?.id, key: key.key,
        action: 'owner_force_reset', status: 'success',
        metadata: {
            message: 'HWID force-reset by owner ' + interaction.user.username + ' for ' + targetUser.username,
            target_discord_id: targetUser.id,
            source: 'discord'
        }
    });

    return interaction.editReply({ embeds: [embed('Force Reset Complete',
        'HWID cleared for <@' + targetUser.id + '>.\n' +
        '**Cooldown:** bypassed\n' +
        '**Reset counter:** restored to 0/5\n' +
        '**Key:** \`' + key.key + '\`', 0x10b981)] });
}


// ========== New handler functions (added) ==========

async function handleSubscription(interaction) {
    const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first.', 0xef4444)] });

    const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!key) return interaction.editReply({ embeds: [embed('No Active Plan', 'You have no active subscription.', 0xef4444)] });

    const expText = key.expires_at
        ? new Date(key.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'Lifetime';
    const daysLeft = key.expires_at
        ? Math.max(0, Math.ceil((new Date(key.expires_at) - new Date()) / 86400000)) + ' days'
        : 'Unlimited';

    return interaction.editReply({ embeds: [embed('Your Subscription',
        '**Plan:** ' + key.plan.toUpperCase() + '\n' +
        '**Status:** ' + key.status + '\n' +
        '**Expires:** ' + expText + '\n' +
        '**Time left:** ' + daysLeft, 0x7c3aed)] });
}

async function handleProfile(interaction) {
    const user = await ensureUserRow(interaction.user);
    if (!user) return interaction.editReply({ embeds: [embed('Error', 'Could not load profile.', 0xef4444)] });

    const { data: keys } = await sb.from('keys').select('status').eq('user_id', user.id);
    const total = keys?.length || 0;
    const active = (keys || []).filter(k => k.status === 'active').length;

    return interaction.editReply({ embeds: [embed('Your Profile',
        '**Username:** ' + (user.username || interaction.user.username) + '\n' +
        '**Discord ID:** ' + interaction.user.id + '\n' +
        '**Joined:** ' + new Date(user.created_at).toLocaleDateString() + '\n' +
        '**Admin:** ' + (user.is_admin ? 'Yes' : 'No') + '\n' +
        '**Blacklisted:** ' + (user.is_banned ? 'Yes' : 'No') + '\n' +
        '**Total keys:** ' + total + ' (' + active + ' active)', 0x7c3aed)] });
}

async function handleHelp(interaction) {
    const userCmds =
        '`/redeem` - Redeem a key.\n' +
        '`/loader` - Get your loader script.\n' +
        '`/script` - Get the latest script.\n' +
        '`/resethwid` - Reset your HWID (every 15 hours).\n' +
        '`/claimrole` - Claim your buyer role.\n' +
        '`/key view` - View your redeemed key.\n' +
        '`/project view` - View your current project.\n' +
        '`/subscription` - Check your plan.\n' +
        '`/profile` - View your account information.\n' +
        '`/help` - Show all commands.\n' +
        '`/status` - Check service status.';

    const adminCmds =
        '`/key create` - Generate a key.\n' +
        '`/key delete` - Delete a key.\n' +
        '`/key extend` - Extend a key.\n' +
        '`/key revoke` - Revoke a key.\n' +
        '`/key info` - View key information.\n' +
        '`/user info` - View user information.\n' +
        '`/user blacklist` - Blacklist a user.\n' +
        '`/user unblacklist` - Remove blacklist.\n' +
        '`/hwid reset` - Force reset HWID.\n' +
        '`/project create` - Create a project.\n' +
        '`/project delete` - Delete a project.\n' +
        '`/project list` - View all projects.';

    const isAdm = await isAdmin(interaction);
    const body = '**User Commands**\n' + userCmds + (isAdm ? '\n\n**Admin Commands**\n' + adminCmds : '');
    return interaction.editReply({ embeds: [embed('NexaKS Commands', body, 0x7c3aed)] });
}

async function handleStatus(interaction) {
    let dbOk = false;
    try {
        const { error } = await sb.from('projects').select('id').limit(1);
        dbOk = !error;
    } catch (_) { dbOk = false; }

    const uptime = process.uptime();
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    return interaction.editReply({ embeds: [embed('Service Status',
        '**Bot:**  Online\n' +
        '**Database:** ' + (dbOk ? ' Connected' : ' Unreachable') + '\n' +
        '**Uptime:** ' + hrs + 'h ' + mins + 'm\n' +
        '**Site:** ' + SITE_URL, dbOk ? 0x10b981 : 0xf59e0b)] });
}

async function handleProjectView(interaction) {
    const { data: user } = await sb.from('users').select('*').eq('discord_id', interaction.user.id).maybeSingle();
    if (!user) return interaction.editReply({ embeds: [embed('No Account', 'Redeem a key first.', 0xef4444)] });

    const { data: key } = await sb.from('keys').select('*').eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!key) return interaction.editReply({ embeds: [embed('No Active License', 'You have no active license.', 0xef4444)] });
    if (!key.project_id) return interaction.editReply({ embeds: [embed('No Project', 'Your key is not tied to any project.', 0xf59e0b)] });

    const { data: proj } = await sb.from('projects').select('*').eq('id', key.project_id).maybeSingle();
    if (!proj) return interaction.editReply({ embeds: [embed('Not Found', 'Project no longer exists.', 0xef4444)] });

    return interaction.editReply({ embeds: [embed('Your Project',
        '**Name:** ' + proj.name + '\n' +
        '**Slug:** `' + proj.slug + '`\n' +
        '**Plan:** ' + key.plan.toUpperCase(), 0x7c3aed)] });
}

async function handleProjectCreate(interaction, slug, name) {
    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!cleanSlug) return interaction.editReply({ embeds: [embed('Invalid Slug', 'Slug must contain a-z, 0-9, _ or -.', 0xef4444)] });

    const { data: existing } = await sb.from('projects').select('id').eq('slug', cleanSlug).maybeSingle();
    if (existing) return interaction.editReply({ embeds: [embed('Exists', 'A project with slug `' + cleanSlug + '` already exists.', 0xef4444)] });

    const admin = await ensureUserRow(interaction.user);
    const { data, error } = await sb.from('projects').insert({
        id: require('crypto').randomUUID(),
        slug: cleanSlug, name: name,
        created_by: admin?.id
    }).select().single();
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    await sb.from('logs').insert({
        user_id: admin?.id, action: 'admin_project_create', status: 'success',
        metadata: { message: 'Created project ' + cleanSlug + ' by ' + interaction.user.username }
    });

    return interaction.editReply({ embeds: [embed('Project Created',
        '**Name:** ' + data.name + '\n**Slug:** `' + data.slug + '`', 0x10b981)] });
}

async function handleProjectDelete(interaction, slug) {
    const cleanSlug = slug.trim().toLowerCase();
    const { data: proj } = await sb.from('projects').select('*').eq('slug', cleanSlug).maybeSingle();
    if (!proj) return interaction.editReply({ embeds: [embed('Not Found', 'No project with slug `' + cleanSlug + '`.', 0xef4444)] });

    const { error } = await sb.from('projects').delete().eq('id', proj.id);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    const admin = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: admin?.id, action: 'admin_project_delete', status: 'success',
        metadata: { message: 'Deleted project ' + cleanSlug + ' by ' + interaction.user.username }
    });

    return interaction.editReply({ embeds: [embed('Project Deleted', '`' + cleanSlug + '` removed.', 0x10b981)] });
}

async function handleProjectList(interaction) {
    const { data: projects } = await sb.from('projects').select('slug, name, created_at').order('created_at', { ascending: false });
    if (!projects || projects.length === 0) {
        return interaction.editReply({ embeds: [embed('No Projects', 'No projects created yet.', 0xf59e0b)] });
    }

    const list = projects.map(p => '* **' + p.name + '** - `' + p.slug + '`').join('\n');
    return interaction.editReply({ embeds: [embed('All Projects (' + projects.length + ')', list, 0x7c3aed)] });
}

async function handleKeyDelete(interaction, key) {
    const { data: existing } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
    if (!existing) return interaction.editReply({ embeds: [embed('Not Found', 'Key does not exist.', 0xef4444)] });

    const { error } = await sb.from('keys').delete().eq('key', key);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    const admin = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: admin?.id, key: key, action: 'admin_key_delete', status: 'success',
        metadata: { message: 'Deleted key ' + key + ' by ' + interaction.user.username }
    });

    return interaction.editReply({ embeds: [embed('Key Deleted', '`' + key + '` permanently removed.', 0x10b981)] });
}

async function handleKeyExtend(interaction, key, days) {
    const { data: existing } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
    if (!existing) return interaction.editReply({ embeds: [embed('Not Found', 'Key does not exist.', 0xef4444)] });

    const base = existing.expires_at ? new Date(existing.expires_at) : new Date();
    if (base < new Date()) base.setTime(Date.now());
    base.setDate(base.getDate() + days);
    const newExp = base.toISOString();

    const { error } = await sb.from('keys').update({ expires_at: newExp }).eq('key', key);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    const admin = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: admin?.id, key: key, action: 'admin_key_extend', status: 'success',
        metadata: { message: 'Extended key ' + key + ' by ' + days + ' days by ' + interaction.user.username }
    });

    return interaction.editReply({ embeds: [embed('Key Extended',
        '`' + key + '` extended by **' + days + '** days.\n' +
        '**New expiry:** ' + new Date(newExp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        0x10b981)] });
}

async function handleKeyLookup(interaction, key) {
    const { data: k } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
    if (!k) return interaction.editReply({ embeds: [embed('Not Found', 'Key does not exist.', 0xef4444)] });

    let ownerLine = 'Unclaimed';
    if (k.user_id) {
        const { data: owner } = await sb.from('users').select('username, discord_id').eq('id', k.user_id).maybeSingle();
        if (owner) ownerLine = (owner.username || 'Unknown') + ' (<@' + owner.discord_id + '>)';
    }

    let projLine = 'None';
    if (k.project_id) {
        const { data: proj } = await sb.from('projects').select('name, slug').eq('id', k.project_id).maybeSingle();
        if (proj) projLine = proj.name + ' (`' + proj.slug + '`)';
    }

    const expText = k.expires_at
        ? new Date(k.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Lifetime';

    return interaction.editReply({ embeds: [embed('Key Info',
        '**Key:** `' + k.key + '`\n' +
        '**Plan:** ' + k.plan.toUpperCase() + '\n' +
        '**Status:** ' + k.status + '\n' +
        '**Owner:** ' + ownerLine + '\n' +
        '**Project:** ' + projLine + '\n' +
        '**Expires:** ' + expText + '\n' +
        '**HWID Resets:** ' + (k.hwid_reset_count || 0) + '/' + (k.hwid_reset_limit || 5) + '\n' +
        '**Executions:** ' + (k.execution_count || 0), 0x7c3aed)] });
}

async function handleBlacklist(interaction, targetUser, reason) {
    const target = await ensureUserRow(targetUser);
    if (!target) return interaction.editReply({ embeds: [embed('Error', 'Could not load user.', 0xef4444)] });

    const { error } = await sb.from('users').update({ is_banned: true }).eq('id', target.id);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    // Revoke all their active keys
    await sb.from('keys').update({ status: 'revoked' }).eq('user_id', target.id).eq('status', 'active');

    const admin = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: admin?.id, action: 'admin_blacklist', status: 'success',
        metadata: {
            message: 'Blacklisted ' + targetUser.username + ' by ' + interaction.user.username,
            target_discord_id: targetUser.id, reason: reason
        }
    });

    return interaction.editReply({ embeds: [embed('User Blacklisted',
        '<@' + targetUser.id + '> has been blacklisted and all active keys revoked.\n**Reason:** ' + reason,
        0x10b981)] });
}

async function handleUnblacklist(interaction, targetUser) {
    const { data: target } = await sb.from('users').select('*').eq('discord_id', targetUser.id).maybeSingle();
    if (!target) return interaction.editReply({ embeds: [embed('Not Found', targetUser.username + ' has no account.', 0xef4444)] });

    const { error } = await sb.from('users').update({ is_banned: false }).eq('id', target.id);
    if (error) return interaction.editReply({ embeds: [embed('Error', error.message, 0xef4444)] });

    const admin = await ensureUserRow(interaction.user);
    await sb.from('logs').insert({
        user_id: admin?.id, action: 'admin_unblacklist', status: 'success',
        metadata: { message: 'Unblacklisted ' + targetUser.username + ' by ' + interaction.user.username, target_discord_id: targetUser.id }
    });

    return interaction.editReply({ embeds: [embed('Blacklist Removed',
        '<@' + targetUser.id + '> is no longer blacklisted.', 0x10b981)] });
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
