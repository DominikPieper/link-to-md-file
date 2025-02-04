import { TFile } from 'obsidian';
import { Note } from 'src/parsers/Note';

export interface VaultRepository {
    saveNote(note: Note): Promise<void>;

    createDirectory(directoryPath: string): Promise<void>;

    exists(filePath: string): Promise<boolean>;

    getFileByPath(filePath: string): TFile;

    appendToExistingNote(note: Note): Promise<void>;
}
