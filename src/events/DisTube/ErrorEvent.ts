import { TextChannel } from 'discord.js';
import { Event } from '../../structures/Event';
import { ErrorEmbed } from '../../utils/Discord/Embed';

export default new Event({
  name: 'error',
  type: 'distube',
  run: (channel: TextChannel, error: Error) => {
    const message = error.message.split('\n').pop();

    switch (message) {
      case 'Unknown Playlist':
        const embed = ErrorEmbed(
          `**Произошла ошибка:** не найден плейлист. 
          Возможно, вы указали ссылку на приватный плейлист или в ссылке на видео содержится указание на приватный плейлист`,
        );
        channel.send({ embeds: [embed] });
        return;
      case "Couldn't find any data in embed page that we know how to parse": {
        const embed = ErrorEmbed(`**Произошла ошибка:** не удалось найти данные в плейлисте Spotify.
          Скорее всего вы указали ссылку на приватный плейлист`);
        channel.send({ embeds: [embed], allowedMentions: { repliedUser: false } });
        return;
      }
      default:
        channel.send({ embeds: [ErrorEmbed(`Произошла ошибка: ${error}`)] });
        break;
    }
  },
});
