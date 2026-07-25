import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ParsedSave, SaveEntry } from "../models/save-model";

function sanitizePathSegment(input: string): string {
  const sanitized = input.replace(/[\\/:*?"<>|]/g, " ").trim();
  return sanitized.length > 0 ? sanitized : "unnamed";
}

export class ExtractionService {
  buildEntryPath(baseDir: string, entry: SaveEntry): string {
    return join(baseDir, sanitizePathSegment(entry.name));
  }

  buildSaveDirectory(baseDir: string, save: ParsedSave): string {
    return join(baseDir, sanitizePathSegment(save.dirName));
  }

  async extractEntry(baseDir: string, entry: SaveEntry): Promise<string> {
    await mkdir(baseDir, { recursive: true });
    const outputPath = this.buildEntryPath(baseDir, entry);
    await writeFile(outputPath, entry.data);
    return outputPath;
  }

  async extractAll(baseDir: string, save: ParsedSave): Promise<string[]> {
    const targetDir = this.buildSaveDirectory(baseDir, save);
    await mkdir(targetDir, { recursive: true });

    const written: string[] = [];
    for (const entry of save.entries) {
      const outputPath = join(targetDir, sanitizePathSegment(entry.name));
      await writeFile(outputPath, entry.data);
      written.push(outputPath);
    }

    return written;
  }

  makeSuggestedFileName(entry: SaveEntry): string {
    return sanitizePathSegment(basename(entry.name));
  }
}
