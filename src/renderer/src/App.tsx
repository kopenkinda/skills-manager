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
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const shellRef = useRef<HTMLElement | null>(null);
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

  useGSAP(
    () => {
      gsap.from("[data-reveal]", {
        y: 16,
        opacity: 0,
        duration: 0.55,
        stagger: 0.06,
        ease: "power3.out",
      });
    },
    { scope: shellRef },
  );

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
    <main ref={shellRef} className="min-h-screen w-full max-w-full overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(54,211,153,0.18),transparent_30%),radial-gradient(circle_at_85%_12%,rgba(245,158,11,0.12),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_38%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-5 px-6 py-5">
        <header data-reveal className="rounded-2xl border bg-card/80 px-5 py-4 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-normal">Skills Manager</h1>
              <p className="mt-1 max-w-4xl truncate text-sm text-muted-foreground">
                {scan?.projectPath ?? "Choose a project folder to inspect local skills and AGENTS.md inheritance."}
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
          </div>
        </header>

        {error ? (
          <div data-reveal className="flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle data-icon="inline-start" />
            <span>{error}</span>
          </div>
        ) : null}

        <section className="grid min-h-0 flex-1 grid-cols-12 gap-5">
          <div data-reveal className="col-span-8 flex min-h-0 flex-col gap-4">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Total" value={counts.all} />
              <Metric label="Enabled" value={counts.enabled} />
              <Metric label="Project" value={counts.project} />
              <Metric label="Global" value={counts.global + counts.system} />
            </div>

            <Card className="min-h-0 flex-1 overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Skills</CardTitle>
                    <CardDescription>Enable, disable, and keep symlinked agent installs aligned.</CardDescription>
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
                    <ScrollArea className="h-[492px] pr-3">
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

          <aside data-reveal className="col-span-4 flex min-h-0 flex-col gap-4">
            {scan?.tokenBudget ? <TokenBudgetCard budget={scan.tokenBudget} /> : null}

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
    <Card className="group overflow-hidden transition-transform duration-500 hover:-translate-y-0.5">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function TokenBudgetCard({ budget }: { budget: TokenBudget }) {
  const overAny = budget.models.some((model) => model.overThreshold);

  return (
    <Card className={cn("overflow-hidden", overAny && "border-destructive/40")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Codex Context</CardTitle>
            <CardDescription>
              Enabled skill registry estimate. {budget.tokenizer}.
            </CardDescription>
          </div>
          <Badge variant={overAny ? "default" : "secondary"}>
            {formatNumber(budget.registryTokens)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Enabled skills</span>
          <span className="font-medium">{budget.enabledSkillCount}</span>
        </div>
        <div className="flex flex-col gap-2">
          {budget.models.map((model) => (
            <div key={model.id} className="rounded-xl border bg-background/70 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{model.id}</span>
                <Badge variant={model.overThreshold ? "default" : "muted"}>
                  {model.usedPercent.toFixed(2)}%
                </Badge>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full bg-primary", model.overThreshold && "bg-destructive")}
                  style={{ width: `${Math.min(model.usedPercent / model.thresholdPercent, 1) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatNumber(budget.registryTokens)} / {formatNumber(model.thresholdTokens)} token 2% budget
              </p>
            </div>
          ))}
        </div>
        {overAny ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle data-icon="inline-start" />
            <span>Enabled skill descriptions exceed the 2% context budget.</span>
          </div>
        ) : null}
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
    <div className="group flex items-center justify-between gap-4 rounded-xl border bg-background/70 px-4 py-3 transition-all duration-300 hover:-translate-y-0.5 hover:bg-accent/60">
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

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

export default App;
