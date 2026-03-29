import {
  InMemoryFs,
  type BufferEncoding,
  type CpOptions,
  type IFileSystem,
  type InitialFiles,
  type MkdirOptions,
  type RmOptions,
} from "just-bash";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Structural match for `just-bash` `DirentEntry` (not exported from the package root). */
type DirentEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

type FsReadOptions = BufferEncoding | { encoding?: BufferEncoding | null };
type FsWriteOptions = BufferEncoding | { encoding?: BufferEncoding };

export interface SupabaseStorageFsOptions {
  supabase: SupabaseClient;
  initialFiles?: InitialFiles;
  bucketName: string;
  prefix: string;
  /** Virtual paths to skip when discovering existing files (e.g. ["/chat/messages.json"]). */
  exclude?: string[];
  /** Called after a file is uploaded to storage. Receives the full storage key. */
  onStorageKeyWritten?: (storageKey: string) => void;
}

export class SupabaseStorageFs implements IFileSystem {
  private readonly baseFs: InMemoryFs;
  private readonly bucketName: string;
  private readonly prefix: string;
  /** Paths registered as placeholders whose content hasn't been fetched yet. */
  private readonly pendingLazy = new Set<string>();
  private readonly onStorageKeyWritten?: (storageKey: string) => void;
  private readonly supabase: SupabaseClient;

  private constructor(
    supabase: SupabaseClient,
    initialFiles: InitialFiles | undefined,
    lazyPaths: string[],
    bucketName: string,
    prefix: string,
    onStorageKeyWritten?: (storageKey: string) => void,
  ) {
    const placeholders: InitialFiles = {};
    for (const p of lazyPaths) {
      const normalized = p.startsWith("/") ? p : `/${p}`;
      if (!initialFiles || !(normalized in initialFiles)) {
        placeholders[normalized] = "";
        this.pendingLazy.add(normalized);
      }
    }

    this.supabase = supabase;
    this.baseFs = new InMemoryFs({ ...placeholders, ...initialFiles });
    this.bucketName = bucketName;
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
    this.onStorageKeyWritten = onStorageKeyWritten;
  }

  /**
   * Create a SupabaseStorageFs.
   *
   * Lists existing files in the bucket under `prefix` and registers them as
   * lazy placeholders (visible in listings, content fetched on first read).
   * Then uploads any caller-provided `initialFiles` to storage.
   */
  static async create(
    options: SupabaseStorageFsOptions,
  ): Promise<SupabaseStorageFs> {
    const prefix = options.prefix.replace(/^\/+|\/+$/g, "");
    const lazyPaths = await listStoredFilePaths(
      options.supabase,
      options.bucketName,
      prefix,
      options.exclude,
    );

    const fs = new SupabaseStorageFs(
      options.supabase,
      options.initialFiles,
      lazyPaths,
      options.bucketName,
      prefix,
      options.onStorageKeyWritten,
    );
    await fs.mirrorInitialFiles();
    return fs;
  }

  /** Upload every initial file in the in-memory fs to Supabase storage. */
  async mirrorInitialFiles(): Promise<void> {
    const paths = this.baseFs.getAllPaths();
    for (const path of paths) {
      if (this.pendingLazy.has(path)) continue;
      const stat = await this.baseFs.stat(path).catch(() => null);
      if (stat?.isFile) {
        await this.mirrorFile(path);
      }
    }
  }

  async readFile(path: string, options?: FsReadOptions) {
    const safePath = this.validatePath(path);
    await this.ensureLazyLoaded(safePath);
    return this.baseFs.readFile(safePath, options);
  }

  async readFileBuffer(path: string) {
    const safePath = this.validatePath(path);
    await this.ensureLazyLoaded(safePath);
    return this.baseFs.readFileBuffer(safePath);
  }

  async writeFile(
    path: string,
    content: string | Uint8Array,
    options?: FsWriteOptions,
  ) {
    const safePath = this.validatePath(path);
    await this.baseFs.writeFile(safePath, content, options);
    await this.mirrorFile(safePath);
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
    options?: FsWriteOptions,
  ) {
    const safePath = this.validatePath(path);
    await this.baseFs.appendFile(safePath, content, options);
    await this.mirrorFile(safePath);
  }

  async exists(path: string) {
    return this.baseFs.exists(this.validatePath(path));
  }

  async stat(path: string) {
    return this.baseFs.stat(this.validatePath(path));
  }

  async lstat(path: string) {
    return this.baseFs.lstat(this.validatePath(path));
  }

  async mkdir(path: string, options?: MkdirOptions) {
    return this.baseFs.mkdir(this.validatePath(path), options);
  }

  async readdir(path: string) {
    return this.baseFs.readdir(this.validatePath(path));
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    return this.baseFs.readdirWithFileTypes(this.validatePath(path));
  }

  async rm(path: string, options?: RmOptions) {
    return this.baseFs.rm(this.validatePath(path), options);
  }

  async cp(src: string, dest: string, options?: CpOptions) {
    const safeSrc = this.validatePath(src);
    const safeDest = this.validatePath(dest);
    await this.baseFs.cp(safeSrc, safeDest, options);
    await this.mirrorFile(safeDest);
  }

  async mv(src: string, dest: string) {
    const safeSrc = this.validatePath(src);
    const safeDest = this.validatePath(dest);
    await this.baseFs.mv(safeSrc, safeDest);
    await this.mirrorFile(safeDest);
  }

  resolvePath(base: string, path: string) {
    const safeBase = this.validatePath(base);
    const safePath = this.validatePath(path);
    return this.baseFs.resolvePath(safeBase, safePath);
  }

  getAllPaths() {
    return this.baseFs.getAllPaths();
  }

  async chmod(path: string, mode: number) {
    return this.baseFs.chmod(this.validatePath(path), mode);
  }

  async symlink(target: string, linkPath: string) {
    return this.baseFs.symlink(
      this.validatePath(target),
      this.validatePath(linkPath),
    );
  }

  async link(existingPath: string, newPath: string) {
    return this.baseFs.link(
      this.validatePath(existingPath),
      this.validatePath(newPath),
    );
  }

  async readlink(path: string) {
    return this.baseFs.readlink(this.validatePath(path));
  }

  async realpath(path: string) {
    return this.baseFs.realpath(this.validatePath(path));
  }

  async utimes(path: string, atime: Date, mtime: Date) {
    return this.baseFs.utimes(this.validatePath(path), atime, mtime);
  }

  /**
   * If `path` is a lazy placeholder, fetch its real content from Supabase
   * and write it into the in-memory fs (without re-uploading).
   */
  private async ensureLazyLoaded(path: string): Promise<void> {
    if (!this.pendingLazy.has(path)) return;

    const key = this.toStorageKey(path);
    if (!key) {
      this.pendingLazy.delete(path);
      return;
    }

    const { data: blob, error } = await this.supabase.storage
      .from(this.bucketName)
      .download(key);

    this.pendingLazy.delete(path);

    if (error || !blob) return;

    try {
      const text = await blob.text();
      await this.baseFs.writeFile(path, text);
    } catch {
      const buf = await blob.arrayBuffer();
      await this.baseFs.writeFile(path, new Uint8Array(buf));
    }
  }

  private async mirrorFile(path: string) {
    const fileStat = await this.baseFs.stat(path).catch(() => null);
    if (!fileStat?.isFile) {
      return;
    }

    const content = await this.baseFs.readFileBuffer(path);
    const key = this.toStorageKey(path);
    if (!key) {
      return;
    }

    const { error } = await this.supabase.storage
      .from(this.bucketName)
      .upload(key, content, { upsert: true });
    if (error) {
      throw error;
    }
    this.onStorageKeyWritten?.(key);
  }

  private toStorageKey(path: string) {
    const relativePath = path.trim().replace(/^\/+/, "");
    if (!relativePath) {
      return "";
    }
    return this.prefix ? `${this.prefix}/${relativePath}` : relativePath;
  }

  private validatePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) {
      throw new Error("Path cannot be empty.");
    }

    const normalized = trimmed.replaceAll("\\", "/");
    const segments = normalized.split("/");
    let depth = 0;

    for (const segment of segments) {
      if (!segment || segment === ".") {
        continue;
      }

      if (segment === "..") {
        if (depth === 0) {
          throw new Error(`Path traversal is not allowed: ${path}`);
        }
        depth -= 1;
        continue;
      }

      depth += 1;
    }

    return normalized;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers – list stored files without downloading content
// ---------------------------------------------------------------------------

async function listStoredFilePaths(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
  exclude?: string[],
): Promise<string[]> {
  const allKeys = await listFilesRecursive(supabase, bucket, prefix);

  const excludeSet = new Set(
    (exclude ?? []).flatMap((p) => {
      const cleaned = p.replace(/^\/+/, "");
      return [cleaned, `/${cleaned}`];
    }),
  );

  const paths: string[] = [];

  for (const key of allKeys) {
    const relativePath = key.slice(prefix.length).replace(/^\/+/, "");
    if (!relativePath) continue;
    if (excludeSet.has(relativePath) || excludeSet.has(`/${relativePath}`))
      continue;
    paths.push("/" + relativePath);
  }

  return paths;
}

async function listFilesRecursive(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const { data: items, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (error || !items) return [];

  const keys: string[] = [];
  const subdirs: string[] = [];

  for (const item of items) {
    if (!item.name || item.name.startsWith(".")) continue;
    const fullPath = `${prefix}/${item.name}`;
    if (item.id === null) {
      subdirs.push(fullPath);
    } else {
      keys.push(fullPath);
    }
  }

  if (subdirs.length > 0) {
    const subResults = await Promise.all(
      subdirs.map((dir) => listFilesRecursive(supabase, bucket, dir)),
    );
    for (const subKeys of subResults) {
      keys.push(...subKeys);
    }
  }

  return keys;
}
