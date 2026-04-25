import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { lstat, readFile, readlink, readdir, rename, rm, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

type SkillScope = "project" | "global" | "system";

type Skill = {
  id: string;
  name: string;
  folderName: string;
  description: string;
  scope: SkillScope;
  rootLabel: string;
  rootPath: string;
  path: string;
  enabled: boolean;
  readonly: boolean;
};

type ScanResult = {
  projectPath: string | null;
  skillRoots: Array<{
    label: string;
    path: string;
    scope: SkillScope;
    exists: boolean;
    readonly: boolean;
  }>;
  skills: Skill[];
};

type AgentsFile = {
  path: string;
  relativePath: string;
  content: string;
};

type UpdateResult = {
  command: string;
  output: string;
  updateCount: number | null;
  updates: Array<{ name: string; source?: string }>;
};

type SkillSymlink = {
  path: string;
  linkTarget: string;
};

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain } = require("electron") as typeof import("electron");
const execFileAsync = promisify(execFile);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 920,
    minHeight: 620,
    title: "Skills Manager",
    backgroundColor: "#f7f4ee",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("project:select", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select project folder",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) return null;
  return scanProject(result.filePaths[0]);
});

ipcMain.handle("project:scan", async (_event, projectPath: string | null) => {
  return scanProject(projectPath);
});

ipcMain.handle("folder:select", async (_event, projectPath: string | null) => {
  const result = await dialog.showOpenDialog({
    title: "Select folder inside project",
    defaultPath: projectPath || undefined,
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle(
  "skill:toggle",
  async (
    _event,
    payload: { rootPath: string; folderName: string; enabled: boolean; readonly: boolean },
  ) => {
    if (payload.readonly) {
      throw new Error("This skill root is read-only.");
    }

    const rootPath = resolve(payload.rootPath);
    const currentPath = resolve(rootPath, payload.folderName);
    const nextFolderName = payload.enabled
      ? stripDisabledSuffix(payload.folderName)
      : `${stripDisabledSuffix(payload.folderName)}.disabled`;
    const nextPath = resolve(rootPath, nextFolderName);

    if (dirname(currentPath) !== rootPath || dirname(nextPath) !== rootPath) {
      throw new Error("Invalid skill path.");
    }
    if (!existsSync(currentPath)) {
      throw new Error("Skill folder no longer exists.");
    }
    if (existsSync(nextPath)) {
      throw new Error(`Target folder already exists: ${nextFolderName}`);
    }

    const symlinks = await findSkillSymlinks(currentPath, rootPath);
    for (const link of symlinks) {
      const nextLinkPath = resolve(dirname(link.path), nextFolderName);
      if (nextLinkPath !== link.path && (await pathExistsNoFollow(nextLinkPath))) {
        throw new Error(`Target symlink already exists: ${nextLinkPath}`);
      }
    }

    const changedSymlinks = await renameSkillSymlinks(symlinks, currentPath, nextPath, nextFolderName);
    try {
      await rename(currentPath, nextPath);
    } catch (err) {
      await restoreSkillSymlinks(changedSymlinks);
      throw err;
    }
    return true;
  },
);

ipcMain.handle(
  "agents:scan",
  async (_event, payload: { projectPath: string; targetPath: string }) => {
    return scanAgentsFiles(payload.projectPath, payload.targetPath);
  },
);

ipcMain.handle("skills:update-project", async (_event, projectPath: string | null) => {
  if (!projectPath) {
    throw new Error("Select a project before updating project skills.");
  }

  const output = await runSkillsCli(["skills", "update", "--project"], projectPath);
  return parseUpdateOutput(output, "pnpx skills update --project");
});

ipcMain.handle("skills:update-global", async () => {
  const output = await runSkillsCli(["skills", "update", "--global"], null);
  return parseUpdateOutput(output, "pnpx skills update --global");
});

async function scanProject(projectPath: string | null): Promise<ScanResult> {
  const normalizedProject = projectPath ? resolve(projectPath) : null;
  const roots = getSkillRoots(normalizedProject);
  const skills = (await Promise.all(roots.map(scanSkillRoot))).flat();

  return {
    projectPath: normalizedProject,
    skillRoots: roots.map((root) => ({
      ...root,
      exists: existsSync(root.path),
    })),
    skills,
  };
}

function getSkillRoots(projectPath: string | null) {
  const roots: Array<{
    label: string;
    path: string;
    scope: SkillScope;
    readonly: boolean;
  }> = [];

  if (projectPath) {
    roots.push({
      label: "Project .agent",
      path: join(projectPath, ".agent", "skills"),
      scope: "project",
      readonly: false,
    });
    roots.push({
      label: "Project .agents",
      path: join(projectPath, ".agents", "skills"),
      scope: "project",
      readonly: false,
    });
  }

  roots.push({
    label: "Global agents",
    path: join(homedir(), ".agents", "skills"),
    scope: "global",
    readonly: false,
  });
  roots.push({
    label: "Codex system",
    path: join(homedir(), ".codex", "skills", ".system"),
    scope: "system",
    readonly: true,
  });

  return roots;
}

async function scanSkillRoot(root: {
  label: string;
  path: string;
  scope: SkillScope;
  readonly: boolean;
}): Promise<Skill[]> {
  if (!existsSync(root.path)) return [];

  const entries = await readdir(root.path, { withFileTypes: true });
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<Skill | null> => {
        const skillPath = join(root.path, entry.name);
        const skillFile = join(skillPath, "SKILL.md");

        if (!existsSync(skillFile)) return null;

        const source = await readFile(skillFile, "utf8");
        const frontmatter = parseFrontmatter(source);
        const cleanFolder = stripDisabledSuffix(entry.name);

        return {
          id: `${root.path}:${entry.name}`,
          name: frontmatter.name || cleanFolder,
          folderName: entry.name,
          description: frontmatter.description || "",
          scope: root.scope,
          rootLabel: root.label,
          rootPath: root.path,
          path: skillPath,
          enabled: entry.name === cleanFolder,
          readonly: root.readonly,
        };
      }),
  );

  return skills
    .filter((skill): skill is Skill => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseFrontmatter(source: string): { name?: string; description?: string } {
  if (!source.startsWith("---")) return {};

  const end = source.indexOf("\n---", 3);
  if (end === -1) return {};

  const fields: Record<string, string> = {};
  const body = source.slice(3, end).split(/\r?\n/);

  for (const line of body) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }

  return {
    name: fields.name,
    description: fields.description,
  };
}

function stripDisabledSuffix(name: string): string {
  return name.endsWith(".disabled") ? name.slice(0, -".disabled".length) : name;
}

async function scanAgentsFiles(projectPath: string, targetPath: string): Promise<AgentsFile[]> {
  const project = resolve(projectPath);
  const target = resolve(targetPath);

  if (!isInsideOrSame(project, target)) {
    throw new Error("Target folder must be inside the selected project.");
  }

  const targetStat = await stat(target);
  let current = targetStat.isDirectory() ? target : dirname(target);
  const dirs: string[] = [];

  while (isInsideOrSame(project, current)) {
    dirs.push(current);
    if (current === project) break;
    current = dirname(current);
  }

  const ordered = dirs.reverse();
  const files: AgentsFile[] = [];

  for (const dir of ordered) {
    const match = await findAgentsFile(dir);
    if (!match) continue;
    const content = await readFile(match, "utf8");
    files.push({
      path: match,
      relativePath: relative(project, match) || basename(match),
      content,
    });
  }

  return files;
}

async function findAgentsFile(dir: string): Promise<string | null> {
  for (const name of ["AGENTS.md", "agents.md", "Agents.md"]) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function isInsideOrSame(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

async function findSkillSymlinks(skillPath: string, rootPath: string): Promise<SkillSymlink[]> {
  const roots = await getCandidateSkillDirs(rootPath);
  const resolvedSkillPath = resolve(skillPath);
  const symlinks: SkillSymlink[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;

    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(root, entry.name);
      const entryStat = await lstat(entryPath);
      if (!entryStat.isSymbolicLink()) continue;

      const linkTarget = await readlink(entryPath);
      const absoluteTarget = isAbsolute(linkTarget)
        ? resolve(linkTarget)
        : resolve(dirname(entryPath), linkTarget);

      if (absoluteTarget === resolvedSkillPath) {
        symlinks.push({ path: entryPath, linkTarget });
      }
    }
  }

  return symlinks;
}

async function getCandidateSkillDirs(rootPath: string): Promise<string[]> {
  const home = homedir();
  const dirs = new Set<string>();
  const projectRoot = getProjectRootFromSkillRoot(rootPath);

  for (const dir of [
    join(home, ".agents", "skills"),
    join(home, ".config", "agents", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".cursor", "skills"),
    join(home, ".gemini", "antigravity", "skills"),
    join(home, ".gemini", "skills"),
    join(home, ".config", "opencode", "skills"),
    join(home, ".copilot", "skills"),
  ]) {
    dirs.add(dir);
  }

  for (const dir of await discoverSkillDirs(home, 4)) {
    dirs.add(dir);
  }

  if (projectRoot) {
    for (const dir of [
      join(projectRoot, ".agent", "skills"),
      join(projectRoot, ".agents", "skills"),
      join(projectRoot, ".claude", "skills"),
      join(projectRoot, ".cursor", "skills"),
      join(projectRoot, ".codex", "skills"),
    ]) {
      dirs.add(dir);
    }
  }

  dirs.add(rootPath);
  return [...dirs];
}

async function discoverSkillDirs(base: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  const ignored = new Set([
    ".cache",
    ".npm",
    ".pnpm-store",
    ".Trash",
    ".vscode",
    "Library",
    "node_modules",
  ]);

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || !existsSync(dir)) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name)) continue;
      if (depth === 0 && !entry.name.startsWith(".")) continue;

      const entryPath = join(dir, entry.name);
      if (entry.name === "skills") {
        found.push(entryPath);
        continue;
      }

      await walk(entryPath, depth + 1);
    }
  }

  await walk(base, 0);
  return found;
}

function getProjectRootFromSkillRoot(rootPath: string): string | null {
  const normalized = resolve(rootPath);
  for (const suffix of [
    `${sep}.agent${sep}skills`,
    `${sep}.agents${sep}skills`,
    `${sep}.claude${sep}skills`,
    `${sep}.cursor${sep}skills`,
    `${sep}.codex${sep}skills`,
  ]) {
    if (normalized.endsWith(suffix)) {
      return normalized.slice(0, -suffix.length);
    }
  }
  return null;
}

async function renameSkillSymlinks(
  symlinks: SkillSymlink[],
  currentPath: string,
  nextPath: string,
  nextFolderName: string,
): Promise<Array<SkillSymlink & { nextPath: string }>> {
  const changed: Array<SkillSymlink & { nextPath: string }> = [];

  for (const link of symlinks) {
    const nextLinkPath = resolve(dirname(link.path), nextFolderName);
    const nextTarget = rewriteSymlinkTarget(link, currentPath, nextPath);

    try {
      await rm(link.path);
      await symlink(nextTarget, nextLinkPath);
      changed.push({ ...link, nextPath: nextLinkPath });
    } catch (err) {
      await restoreSkillSymlinks(changed);
      throw err;
    }
  }

  return changed;
}

async function restoreSkillSymlinks(symlinks: Array<SkillSymlink & { nextPath: string }>) {
  for (const link of symlinks.reverse()) {
    if (await pathExistsNoFollow(link.nextPath)) {
      await rm(link.nextPath);
    }
    if (!(await pathExistsNoFollow(link.path))) {
      await symlink(link.linkTarget, link.path);
    }
  }
}

function rewriteSymlinkTarget(link: SkillSymlink, currentPath: string, nextPath: string): string {
  if (isAbsolute(link.linkTarget)) return nextPath;

  const currentTarget = resolve(dirname(link.path), link.linkTarget);
  if (currentTarget !== resolve(currentPath)) {
    return link.linkTarget;
  }

  return relative(dirname(link.path), nextPath);
}

async function pathExistsNoFollow(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function runSkillsCli(args: string[], projectPath: string | null): Promise<string> {
  const cwd = projectPath && existsSync(projectPath) ? projectPath : homedir();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  try {
    const { stdout, stderr } = await execFileAsync("pnpx", args, {
      cwd,
      env,
      maxBuffer: 1024 * 1024 * 4,
      timeout: 120_000,
    });
    return stripAnsi([stdout, stderr].filter(Boolean).join("\n"));
  } catch (err) {
    if (isExecError(err)) {
      const output = stripAnsi([err.stdout, err.stderr].filter(Boolean).join("\n"));
      throw new Error(output || err.message);
    }
    throw err;
  }
}

function parseUpdateOutput(output: string, command: string): UpdateResult {
  const updates: Array<{ name: string; source?: string }> = [];
  const lines = output.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const match = line.match(/^↑\s+(.+)$/);
    if (!match) continue;

    const next = lines[i + 1]?.trim();
    const source = next?.startsWith("source:") ? next.slice("source:".length).trim() : undefined;
    updates.push({ name: match[1].trim(), source });
  }

  const countMatch =
    output.match(/Found\s+(\d+)\s+update\(s\)/) ||
    output.match(/(\d+)\s+update\(s\)\s+available/);

  return {
    command,
    output,
    updateCount: countMatch ? Number(countMatch[1]) : updates.length,
    updates,
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "\n");
}

function isExecError(err: unknown): err is Error & { stdout?: string; stderr?: string } {
  return err instanceof Error && ("stdout" in err || "stderr" in err);
}
