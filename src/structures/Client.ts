import SoundCloudPlugin from '@distube/soundcloud';
import SpotifyPlugin from '@distube/spotify';
import { Client as NotionClient } from '@notionhq/client';
import AniDB from 'anidbjs';
import discordModals from 'discord-modals';
import { Client, Collection, Intents, Snowflake } from 'discord.js';
import { DisTube } from 'distube';
import { glob } from 'glob';
import mongoose from 'mongoose';
import { promisify } from 'util';
import { Environment } from '../../environment';
import { GuildModel } from '../models/GuildModel';
import { MemberModel } from '../models/MemberModel';
import { MongoData } from '../typings/Database';
import { IGuildModel } from '../typings/GuildModel';
import { IMemberModel } from '../typings/MemberModel';
import Logger from '../utils/Logger';
import { CacheManager } from './CacheManager';
import { CommonCommand } from './Commands/CommonCommand';
import { ContextCommand } from './Commands/ContextCommand';
import { SlashCommand } from './Commands/SlashCommand';
import { DiscordEvent, DiscordEventNames, DisTubeEvent, DisTubeEventNames } from './Event';
import { Service } from './Service';

const globPromise = promisify(glob);

export class ExtendClient extends Client<true> {
  commonCommands: Collection<string, CommonCommand> = new Collection(); // <Name, CommonCommand>
  contextCommands: Collection<string, ContextCommand> = new Collection(); // <Name, ContextCommand>
  slashCommands: Collection<string, SlashCommand> = new Collection(); // <Name, ContextCommand>
  categories: Set<string> = new Set();
  aliases: Collection<string, string> = new Collection(); // <Alias, OriginalCommandName>
  disTube: DisTube;
  notion: NotionClient;
  aniDB = new AniDB({ client: 'hltesttwo', version: 9 });
  config: Environment = process.env;
  invites: Collection<string, Collection<string, number>> = new Collection(); // <InviteCode, <AuthorId, Uses>
  memberBase: CacheManager<MongoData<IMemberModel>>;
  guildBase: CacheManager<MongoData<IGuildModel>>;
  service: Service;
  customVoicesState: Collection<Snowflake, [Snowflake, Snowflake]> = new Collection(); // <VoiceId, [AuthorId,TextChannelId]>

  constructor() {
    super({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_VOICE_STATES,
        Intents.FLAGS.GUILD_INVITES,
        Intents.FLAGS.GUILD_MEMBERS,
        Intents.FLAGS.GUILD_PRESENCES,
      ],
    });
  }

  async start(): Promise<void> {
    if (!this.config.botToken) {
      Logger.error('No discord token provided. Bot will not start.');
      return;
    }

    this.disTube = new DisTube(this, {
      searchSongs: 1,
      searchCooldown: 30,
      emptyCooldown: 20,
      leaveOnFinish: true,
      plugins: [new SoundCloudPlugin(), new SpotifyPlugin()],
      youtubeCookie: this.config.distubeCookie,
      youtubeDL: false,
      nsfw: true,
      ytdlOptions: {
        quality: 'highestvideo',
      },
    });

    this.config.environment = this.config.environment || 'development';

    if (this.config.mongoURI) {
      mongoose
        .connect(this.config.mongoURI)
        .then(() => Logger.success('Success connected to MongoDB'))
        .catch((error) => Logger.error(error));
    } else {
      Logger.warn('No MongoDB URI provided. Database features and some commands will not work.');
    }

    this.service = new Service(this);

    this.notion = new NotionClient({
      auth: this.config.notionToken,
    });

    await this.loadCommonCommands();
    await this.loadEvents();

    await this.loadContextCommands();
    await this.loadSlashCommands();

    this.memberBase = new CacheManager({
      maxCacheSize: 100,
      getCallback: this.getMemberBase,
    });
    this.guildBase = new CacheManager({
      maxCacheSize: 100,
      getCallback: this.getGuildBase,
    });

    Logger.info(`Loaded ${this.commonCommands.size} common commands on ${this.categories.size} categories`);
    Logger.info(`Loaded ${this.contextCommands.size} context commands`);
    Logger.info(`Loaded ${this.slashCommands.size} slash commands`);

    discordModals(this);
    await this.login(process.env.botToken);
  }

  public getOwners(): string[] {
    return this.config.ownersID?.split(',') || [];
  }

  public async getPrefix(guildId?: string): Promise<string> {
    return (this.config.mongoURI && guildId ? await this.service.getPrefix(guildId) : this.config.prefix) ?? '>';
  }

  private static async importFile(filePath: string) {
    const { default: file } = await import(filePath);
    return file;
  }

  private async loadFiles<T>(path: `/${string}`): Promise<T[]> {
    const rootDirectory = __dirname.replaceAll('\\', '/');
    const files = await globPromise(`${rootDirectory}/..` + path);

    return Promise.all(files.map(async (file) => await ExtendClient.importFile(file)));
  }

  private async loadCommonCommands() {
    const commonCommandFiles = await this.loadFiles<CommonCommand>('/commands/Common/**/*.{js,ts}');

    commonCommandFiles.map(async (command) => {
      if (command.name) {
        this.commonCommands.set(command.name.toLowerCase(), command);
        this.categories.add(command.category.toLowerCase());

        if (command.aliases?.length) {
          command.aliases.map((alias: string) => this.aliases.set(alias.toLowerCase(), command.name.toLowerCase()));
        }
      }
    });
  }

  private async loadContextCommands() {
    const contextCommandFiles = await this.loadFiles<ContextCommand>('/commands/Context/**/*.{js,ts}');

    contextCommandFiles.map(async (contextCommand) => {
      if (contextCommand.name) {
        this.contextCommands.set(contextCommand.name, contextCommand);
      }
    });
  }

  private async loadSlashCommands() {
    const slashCommandFiles = await this.loadFiles<SlashCommand>('/commands/Slash/**/*.{js,ts}');

    slashCommandFiles.map(async (slashCommand) => {
      if (slashCommand.meta?.name) {
        this.slashCommands.set(slashCommand.meta.name, slashCommand);
      }
    });
  }

  private async loadEvents() {
    const eventFiles = await this.loadFiles<DiscordEvent<DiscordEventNames> | DisTubeEvent<DisTubeEventNames>>(
      '/events/**/*.{js,ts}',
    );

    eventFiles.map((event) => {
      if (event.name) {
        if (event instanceof DisTubeEvent) {
          this.disTube.on(event.name, event.run.bind(null, this));
          return;
        }

        if (event instanceof DiscordEvent) {
          this.on(event.name, event.run.bind(null, this));
          return;
        }
      }
    });
  }

  protected async getMemberBase(id: string): Promise<MongoData<IMemberModel>> {
    let MemberData = await MemberModel.findById(id);

    if (!MemberData) {
      MemberData = await MemberModel.create({
        _id: id,
      });

      await MemberData.save();
    }

    return MemberData;
  }

  protected async getGuildBase(id: string): Promise<MongoData<IGuildModel>> {
    let GuildData = await GuildModel.findById(id);

    if (!GuildData) {
      GuildData = await GuildModel.create({
        _id: id,
        prefix: process.env.prefix || '>',
      });

      await GuildData.save();
    }

    return GuildData;
  }
}
