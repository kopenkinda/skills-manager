import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Globe2,
  Lock,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type SkillFilter = "all" | "project" | "global" | "system";

const filterLabels: Record<SkillFilter, string> = {
  all: "All",
  project: "Project",
  global: "Global",
  system: "System",
};

function App() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [agentsFiles, setAgentsFiles] = useState<AgentsFile[]>([]);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh(null);
  }, []);

  const skills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (scan?.skills ?? []).filter((skill) => {
      const matchesFilter = filter === "all" || skill.scope === filter;
      const matchesQuery =
        !needle ||
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle) ||
        skill.rootLabel.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, scan]);

  const counts = useMemo(() => {
    const all = scan?.skills ?? [];
    return {
      all: all.length,
      project: all.filter((skill) => skill.scope === "project").length,
      global: all.filter((skill) => skill.scope === "global").length,
      system: all.filter((skill) => skill.scope === "system").length,
      enabled: all.filter((skill) => skill.enabled).length,
    };
  }, [scan]);

  async function refresh(projectPath = scan?.projectPath ?? null) {
    if (!window.skillsManager) {
      setError("Electron preload API unavailable. Restart the app after rebuilding.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await window.skillsManager.scanProject(projectPath);
      setScan(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function selectProject() {
    if (!window.skillsManager) {
      setError("Electron preload API unavailable. Restart the app after rebuilding.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await window.skillsManager.selectProject();
      if (!result) return;
      setScan(result);
      setTargetPath(null);
      setAgentsFiles([]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSkill(skill: Skill) {
    setBusy(true);
    setError(null);
    try {
      await window.skillsManager.toggleSkill({
        rootPath: skill.rootPath,
        folderName: skill.folderName,
        enabled: !skill.enabled,
        readonly: skill.readonly,
      });
      await refresh(scan?.projectPath ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function selectAgentsFolder() {
    if (!scan?.projectPath) return;

    setBusy(true);
    setError(null);
    try {
      const selected = await window.skillsManager.selectFolder(scan.projectPath);
      if (!selected) return;
      const files = await window.skillsManager.scanAgents({
        projectPath: scan.projectPath,
        targetPath: selected,
      });
      setTargetPath(selected);
      setAgentsFiles(files);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateProjectSkills() {
    if (!window.skillsManager) {
      setError("Electron preload API unavailable. Restart the app after rebuilding.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await window.skillsManager.updateProject(scan?.projectPath ?? null);
      setUpdateResult(result);
      await refresh(scan?.projectPath ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateGlobalSkills() {
    if (!window.skillsManager) {
      setError("Electron preload API unavailable. Restart the app after rebuilding.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await window.skillsManager.updateGlobal();
      setUpdateResult(result);
      await refresh(scan?.projectPath ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-6 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal">Skills Manager</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {scan?.projectPath ?? "No project selected"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refresh()} disabled={busy}>
              <RefreshCw data-icon="inline-start" className={cn(busy && "animate-spin")} />
              Refresh
            </Button>
            <Button onClick={selectProject} disabled={busy}>
              <FolderOpen data-icon="inline-start" />
              Select Project
            </Button>
          </div>
        </header>

        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle data-icon="inline-start" />
            <span>{error}</span>
          </div>
        ) : null}

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div className="flex min-h-0 flex-col gap-4">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Total" value={counts.all} />
              <Metric label="Enabled" value={counts.enabled} />
              <Metric label="Project" value={counts.project} />
              <Metric label="Global" value={counts.global + counts.system} />
            </div>

            <Card className="min-h-0 flex-1">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Skills</CardTitle>
                    <CardDescription>Toggle project/global skills by renaming folders.</CardDescription>
                  </div>
                  <div className="relative w-72 max-w-full">
                    <Search className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="pl-9"
                      placeholder="Search skills"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-col gap-4">
                <Tabs value={filter} onValueChange={(value) => setFilter(value as SkillFilter)}>
                  <TabsList>
                    {(Object.keys(filterLabels) as SkillFilter[]).map((key) => (
                      <TabsTrigger key={key} value={key}>
                        {filterLabels[key]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <TabsContent value={filter} className="min-h-0">
                    <ScrollArea className="h-[430px] pr-3">
                      <div className="flex flex-col gap-3">
                        {skills.length ? (
                          skills.map((skill) => (
                            <SkillRow
                              key={skill.id}
                              skill={skill}
                              disabled={busy}
                              onToggle={() => toggleSkill(skill)}
                            />
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                            No skills found.
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-h-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Updates</CardTitle>
                    <CardDescription>Runs pnpx skills update.</CardDescription>
                  </div>
                  <Badge variant={updateResult?.updateCount ? "default" : "secondary"}>
                    {updateResult?.updateCount ?? "-"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={updateProjectSkills}
                    disabled={busy || !scan?.projectPath}
                  >
                    <Download data-icon="inline-start" />
                    Project
                  </Button>
                  <Button size="sm" onClick={updateGlobalSkills} disabled={busy}>
                    <Download data-icon="inline-start" />
                    Global
                  </Button>
                </div>
                {updateResult ? (
                  <div className="rounded-lg border bg-background">
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="truncate text-xs font-medium">{updateResult.command}</span>
                      <Badge variant="muted">
                        {updateResult.updates.length ? `${updateResult.updates.length} listed` : "Done"}
                      </Badge>
                    </div>
                    <Separator />
                    <ScrollArea className="h-32">
                      <pre className="whitespace-pre-wrap break-words p-3 text-xs leading-5 text-muted-foreground">
                        {updateResult.output}
                      </pre>
                    </ScrollArea>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Skill Roots</CardTitle>
                <CardDescription>Detected install locations.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3">
                  {(scan?.skillRoots ?? []).map((root) => (
                    <div key={root.path} className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {root.readonly ? <Lock data-icon="inline-start" /> : <Globe2 data-icon="inline-start" />}
                          <span>{root.label}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{root.path}</p>
                      </div>
                      <Badge variant={root.exists ? "secondary" : "outline"}>
                        {root.exists ? "Found" : "Missing"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-0 flex-1">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>AGENTS.md</CardTitle>
                    <CardDescription>Files applied from project root to selected folder.</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={selectAgentsFolder}
                    disabled={busy || !scan?.projectPath}
                  >
                    <FolderOpen data-icon="inline-start" />
                    Pick
                  </Button>
                </div>
                {targetPath ? <p className="truncate text-xs text-muted-foreground">{targetPath}</p> : null}
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[360px] pr-3">
                  <div className="flex flex-col gap-3">
                    {agentsFiles.length ? (
                      agentsFiles.map((file, index) => (
                        <div key={file.path} className="rounded-lg border bg-background">
                          <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <span className="truncate text-sm font-medium">{file.relativePath}</span>
                            <Badge variant="muted">#{index + 1}</Badge>
                          </div>
                          <Separator />
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 text-muted-foreground">
                            {file.content}
                          </pre>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {scan?.projectPath ? "Pick a folder to inspect." : "Select a project first."}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function SkillRow({
  skill,
  disabled,
  onToggle,
}: {
  skill: Skill;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{skill.name}</span>
          <Badge variant={skill.scope === "project" ? "default" : skill.scope === "system" ? "outline" : "secondary"}>
            {skill.rootLabel}
          </Badge>
          {!skill.enabled ? <Badge variant="muted">Disabled</Badge> : null}
          {skill.readonly ? <Badge variant="outline">Read-only</Badge> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {skill.description || skill.path}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {skill.enabled ? (
          <CheckCircle2 className="text-primary" />
        ) : (
          <AlertCircle className="text-muted-foreground" />
        )}
        <Switch
          checked={skill.enabled}
          disabled={disabled || skill.readonly}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${skill.name}`}
        />
      </div>
    </div>
  );
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default App;
