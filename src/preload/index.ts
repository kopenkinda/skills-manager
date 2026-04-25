import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = {
  selectProject: () => ipcRenderer.invoke("project:select"),
  scanProject: (projectPath: string | null) => ipcRenderer.invoke("project:scan", projectPath),
  selectFolder: (projectPath: string | null) => ipcRenderer.invoke("folder:select", projectPath),
  toggleSkill: (payload: {
    rootPath: string;
    folderName: string;
    enabled: boolean;
    readonly: boolean;
  }) => ipcRenderer.invoke("skill:toggle", payload),
  scanAgents: (payload: { projectPath: string; targetPath: string }) =>
    ipcRenderer.invoke("agents:scan", payload),
  updateProject: (projectPath: string | null) =>
    ipcRenderer.invoke("skills:update-project", projectPath),
  updateGlobal: () => ipcRenderer.invoke("skills:update-global"),
};

contextBridge.exposeInMainWorld("skillsManager", api);

export type SkillsManagerApi = typeof api;
