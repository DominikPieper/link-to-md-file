import { App, moment, request } from 'obsidian';
import { Duration, parse, toSeconds } from 'iso8601-duration';
import { ReadItLaterSettings } from '../settings';
import { handleError } from '../helpers';
import { Note } from './Note';
import { Parser } from './Parser';

interface YoutubeVideo {
    id: string;
    url: string;
    title: string;
    description: string;
    thumbnail: string;
    duration: Number;
    durationFormatted: string;
    pubDate: string;
    player: string;
    viewsCount: Number;
    tags: string[];
    channel: YoutubeChannel;
}

interface YoutubeChannel {
    id: string;
    url: string;
    name: string;
}

class YoutubeParser extends Parser {
    private PATTERN = /(youtube.com|youtu.be)\/(watch|shorts)?(\?v=|\/)?([^&#?]*)/;

    constructor(app: App, settings: ReadItLaterSettings) {
        super(app, settings);
    }

    test(url: string): boolean {
        return this.isValidUrl(url) && this.PATTERN.test(url);
    }

    async prepareNote(url: string): Promise<Note> {
        const video =
            this.settings.youtubeApiKey === '' ? await this.parseSchema(url) : await this.parseApiResponse(url);

        const content = this.settings.youtubeNote
            .replace(/%date%/g, this.getFormattedDateForContent())
            .replace(/%videoTitle%/g, () => video.title)
            .replace(/%videoId%/g, () => video.id)
            .replace(/%videoDescription%/g, () => video.description)
            .replace(/%videoThumbnail%/g, () => video.thumbnail)
            .replace(/%videoDuration%/g, video.duration.toString())
            .replace(/%videoDurationFormatted%/g, video.durationFormatted)
            .replace(/%videoPublishDate%/g, video.pubDate.toString())
            .replace(/%videoViewsCount%/g, video.viewsCount.toString())
            .replace(/%videoURL%/g, () => video.url)
            .replace(/%channelId%/g, () => video.channel.id)
            .replace(/%channelName%/g, () => video.channel.name)
            .replace(/%channelURL%/g, () => video.channel.url)
            .replace(/%videoTags%/g, () => video.tags.join(' '))
            .replace(/%videoPlayer%/g, () => video.player);

        const fileNameTemplate = this.settings.youtubeNoteTitle
            .replace(/%title%/g, () => video.title)
            .replace(/%date%/g, this.getFormattedDateForFilename());

        const fileName = `${fileNameTemplate}.md`;
        return new Note(fileName, content);
    }

    private async parseApiResponse(url: string): Promise<YoutubeVideo> {
        const videoId = this.PATTERN.exec(url)[4];
        try {
            const videoApiResponse = await request({
                method: 'GET',
                url: `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet,statistics,status,topicDetails&id=${videoId}&key=${this.settings.youtubeApiKey}`,
                headers: {
                    Accept: 'application/json',
                },
            });

            const videoJsonResponse = JSON.parse(videoApiResponse);
            if (videoJsonResponse.items.length === 0) {
                throw new Error(`Video (${url}) cannot be fetched from API`);
            }
            const video: GoogleApiYouTubeVideoResource = videoJsonResponse.items[0];

            const channelApiResponse = await request({
                method: 'GET',
                url: `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${video.snippet.channelId}&key=${this.settings.youtubeApiKey}`,
                headers: {
                    Accept: 'application/json',
                },
            });
            const channelJsonResponse = JSON.parse(channelApiResponse);
            if (channelJsonResponse.items.length === 0) {
                throw new Error(`Channel (${video.snippet.channelId}) cannot be fetched from API`);
            }
            const channel: GoogleApiYouTubeChannelResource = channelJsonResponse.items[0];

            const duration = parse(video.contentDetails.duration);
            return {
                id: video.id,
                url: url,
                title: video.snippet.title,
                description: video.snippet.description,
                thumbnail:
                    video.snippet.thumbnails?.maxres?.url ??
                    video.snippet.thumbnails?.medium?.url ??
                    video.snippet.thumbnails?.default?.url ??
                    '',
                player: this.getEmbedPlayer(video.id),
                duration: toSeconds(duration),
                durationFormatted: this.formatDuration(duration),
                pubDate: moment(video.snippet.publishedAt).format(this.settings.dateContentFmt),
                viewsCount: video.statistics.viewCount,
                tags: Object.prototype.hasOwnProperty.call(video, 'tags')
                    ? video.snippet.tags.map((tag) => tag.replace(/[\s:\-_.]/g, '').replace(/^/, '#'))
                    : [],
                channel: {
                    id: channel.id,
                    url: `https://www.youtube.com/channel/${channel.id}`,
                    name: channel.snippet.title ?? '',
                },
            };
        } catch (e) {
            handleError(e);
        }
    }

    private async parseSchema(url: string): Promise<YoutubeVideo> {
        try {
            const response = await request({
                method: 'GET',
                url,
                headers: {
                    'user-agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                },
            });

            const videoHTML = new DOMParser().parseFromString(response, 'text/html');
            const videoSchemaElement = videoHTML.querySelector('[itemtype*="http://schema.org/VideoObject"]');

            if (videoSchemaElement === null) {
                throw new Error('Unable to find Schema.org element in HTML.');
            }

            const videoId = videoSchemaElement?.querySelector('[itemprop="identifier"]')?.getAttribute('content') ?? '';
            const personSchemaElement = videoSchemaElement.querySelector('[itemtype="http://schema.org/Person"]');

            return {
                id: videoId,
                url: url,
                title: videoSchemaElement?.querySelector('[itemprop="name"]')?.getAttribute('content') ?? '',
                description:
                    videoSchemaElement?.querySelector('[itemprop="description"]')?.getAttribute('content') ?? '',
                thumbnail: videoHTML.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
                player: this.getEmbedPlayer(videoId),
                duration: 0,
                durationFormatted: '',
                pubDate: '',
                viewsCount: 0,
                tags: [],
                channel: {
                    id: videoSchemaElement?.querySelector('[itemprop="channelId"')?.getAttribute('content') ?? '',
                    url: personSchemaElement?.querySelector('[itemprop="url"]')?.getAttribute('href') ?? '',
                    name: personSchemaElement?.querySelector('[itemprop="name"]')?.getAttribute('content') ?? '',
                },
            };
        } catch (e) {
            handleError(e);
        }
    }

    private formatDuration(duration: Duration): string {
        let formatted: string = '';

        if (duration.years > 0) {
            formatted = formatted.concat(' ', `${duration.years}y`);
        }

        if (duration.months > 0) {
            formatted = formatted.concat(' ', `${duration.months}m`);
        }

        if (duration.weeks > 0) {
            formatted = formatted.concat(' ', `${duration.weeks}w`);
        }

        if (duration.days > 0) {
            formatted = formatted.concat(' ', `${duration.days}d`);
        }

        if (duration.hours > 0) {
            formatted = formatted.concat(' ', `${duration.hours}h`);
        }

        if (duration.minutes > 0) {
            formatted = formatted.concat(' ', `${duration.minutes}m`);
        }

        if (duration.seconds > 0) {
            formatted = formatted.concat(' ', `${duration.seconds}s`);
        }

        return formatted.trim();
    }

    private getEmbedPlayer(videoId: string): string {
        const domain = this.settings.youtubeUsePrivacyEnhancedEmbed ? 'youtube-nocookie.com' : 'youtube.com';
        return `<iframe width="${this.settings.youtubeEmbedWidth}" height="${this.settings.youtubeEmbedHeight}" src="https://www.${domain}/embed/${videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    }
}

export default YoutubeParser;
