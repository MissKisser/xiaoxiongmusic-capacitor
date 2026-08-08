/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 */
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { SongType } from "@/types/main";

const ROOT = "lyrics";

export interface LocalTtmlEntry {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

const normalize = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .trim();

const safeName = (name: string) =>
  name.replace(/\.ttml$/i, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";

const filePath = (name: string) => `${ROOT}/${safeName(name)}.ttml`;

export const listLocalTtml = async (): Promise<LocalTtmlEntry[]> => {
  try {
    const result = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    return result.files
      .filter((file) => file.type !== "directory" && file.name.toLowerCase().endsWith(".ttml"))
      .map((file) => ({
        name: file.name,
        path: `${ROOT}/${file.name}`,
        size: file.size ?? 0,
        mtime: file.mtime ?? 0,
      }));
  } catch {
    return [];
  }
};

export const readLocalTtml = async (path: string): Promise<string | null> => {
  try {
    const result = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
    return typeof result.data === "string" ? result.data : null;
  } catch {
    return null;
  }
};

export const saveLocalTtml = async (name: string, data: string): Promise<string> => {
  await Filesystem.mkdir({ path: ROOT, directory: Directory.Data, recursive: true }).catch(() => undefined);
  const path = filePath(name);
  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  return path;
};

export const deleteLocalTtml = async (path: string): Promise<void> => {
  await Filesystem.deleteFile({ path, directory: Directory.Data });
};

export const renameLocalTtml = async (path: string, name: string): Promise<string> => {
  const target = filePath(name);
  await Filesystem.rename({ from: path, to: target, directory: Directory.Data });
  return target;
};

export const matchLocalTtml = async (song: SongType): Promise<string | null> => {
  const wanted = normalize(song.name);
  const artist = normalize(
    Array.isArray(song.artists) ? song.artists[0]?.name ?? "" : String(song.artists ?? ""),
  );
  const candidates = new Set([wanted, normalize(`${song.name}-${artist}`), normalize(`${song.name} - ${artist}`)]);
  for (const entry of await listLocalTtml()) {
    const stem = normalize(entry.name.replace(/\.ttml$/i, ""));
    if (!candidates.has(stem)) continue;
    const data = await readLocalTtml(entry.path);
    if (data) return data;
  }
  return null;
};
