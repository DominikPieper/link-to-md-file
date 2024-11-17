import { App, moment, request } from 'obsidian';
import { ReadItLaterSettings } from '../settings';
import { Parser } from './Parser';
import { Note } from './Note';
import { parseHtmlContent } from './parsehtml';
import TemplateEngine from 'src/template/TemplateEngine';

class TwitterParser extends Parser {
    private PATTERN = /(https:\/\/(twitter|x).com\/([a-zA-Z0-9_]+\/)([a-zA-Z0-9_]+\/[a-zA-Z0-9_]+))/;

    constructor(app: App, settings: ReadItLaterSettings, templateEngine: TemplateEngine) {
        super(app, settings, templateEngine);
    }

    test(url: string): boolean {
        return this.isValidUrl(url) && this.PATTERN.test(url);
    }

    async prepareNote(url: string): Promise<Note> {
        const twitterUrl = new URL(url);

        if (twitterUrl.hostname === 'x.com') {
            twitterUrl.hostname = 'twitter.com';
        }

        const response = JSON.parse(
            await request({
                method: 'GET',
                contentType: 'application/json',
                url: `https://publish.twitter.com/oembed?url=${twitterUrl.href}`,
            }),
        );

        const tweetAuthorName = response.author_name;
        const content = await parseHtmlContent(response.html);

        const processedContent = this.settings.twitterNote
            .replace(/%date%/g, this.getFormattedDateForContent())
            .replace(/%tweetAuthorName%/g, () => tweetAuthorName)
            .replace(/%tweetURL%/g, () => response.url)
            .replace(/%tweetContent%/g, () => content)
            .replace(/%tweetPublishDate%/g, () => this.getPublishedDateFromDOM(response.html));

        const fileNameTemplate = this.settings.twitterNoteTitle
            .replace(/%tweetAuthorName%/g, () => tweetAuthorName)
            .replace(/%date%/g, this.getFormattedDateForFilename());

        const fileName = `${fileNameTemplate}.md`;

        return new Note(fileName, processedContent);
    }

    private getPublishedDateFromDOM(html: string): string {
        const dom = new DOMParser().parseFromString(html, 'text/html');
        const dateElement = dom.querySelector('blockquote > a');
        const date = moment(dateElement.textContent);

        return date.isValid() ? date.format(this.settings.dateContentFmt) : '';
    }
}

export default TwitterParser;
