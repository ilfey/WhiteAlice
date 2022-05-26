import { ErrorEmbed, SuccessEmbed } from '../../utils/Discord/Embed';
import { PermissionString } from 'discord.js';
import { Command, CommandRunOptions } from '../../structures/Command';

class PrefixCommand extends Command {
  name = 'prefix';
  category = 'Administration';
  aliases = [];
  description = '';
  examples = [];
  usage = 'update';
  memberPermissions: PermissionString[] = ['MANAGE_GUILD'];

  async run({ client, message, args }: CommandRunOptions) {
    const prefix = args[0];

    if (!prefix) {
      const embed = ErrorEmbed('Укажите префикс');
      message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return;
    }

    if (prefix.length > 3) {
      const embed = ErrorEmbed('Длинна префикса не может быть больше 3 символов');
      message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return;
    }

    client.service.setPrefix(message.guildId, prefix);

    const embed = SuccessEmbed(`Префикс успешно изменён на \`${prefix}\``);
    message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
  }
}

export default new PrefixCommand();
