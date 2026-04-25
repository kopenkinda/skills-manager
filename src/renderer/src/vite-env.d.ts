/// <reference types="vite/client" />

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
  tokenBudget: TokenBudget;
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

type TokenBudget = {
  tokenizer: string;
  enabledSkillCount: number;
  registryTokens: number;
  models: Array<{
    id: "gpt-5.4" | "gpt-5.5";
    contextWindow: number;
    thresholdPercent: number;
    thresholdTokens: number;
    usedPercent: number;
    overThreshold: boolean;
  }>;
};

interface Window {
  skillsManager: {
    selectProject: () => Promise<ScanResult | null>;
    scanProject: (projectPath: string | null) => Promise<ScanResult>;
    selectFolder: (projectPath: string | null) => Promise<string | null>;
    toggleSkill: (payload: {
      rootPath: string;
      folderName: string;
      enabled: boolean;
      readonly: boolean;
    }) => Promise<boolean>;
    scanAgents: (payload: { projectPath: string; targetPath: string }) => Promise<AgentsFile[]>;
    updateProject: (projectPath: string | null) => Promise<UpdateResult>;
    updateGlobal: () => Promise<UpdateResult>;
  };
}
