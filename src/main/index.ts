import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

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

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain } = require("electron") as typeof import("electron");

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

    await rename(currentPath, nextPath);
    return true;
  },
);

ipcMain.handle(
  "agents:scan",
  async (_event, payload: { projectPath: string; targetPath: string }) => {
    return scanAgentsFiles(payload.projectPath, payload.targetPath);
  },
);

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
