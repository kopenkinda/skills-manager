import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var scan: ScanResult?
    @Published var query = ""
    @Published var filter: SkillFilter = .all
    @Published var updateResult: UpdateResult?
    @Published var busy = false
    @Published var error: String?

    let service = SkillService()

    var filteredSkills: [Skill] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return (scan?.skills ?? []).filter { skill in
            let matchesFilter = filter == .all || skill.scope.rawValue == filter.rawValue
            let matchesQuery = needle.isEmpty
                || skill.name.lowercased().contains(needle)
                || skill.description.lowercased().contains(needle)
                || skill.rootLabel.lowercased().contains(needle)
            return matchesFilter && matchesQuery
        }
    }

    var counts: (all: Int, enabled: Int, project: Int, globalAndSystem: Int) {
        let skills = scan?.skills ?? []
        return (
            skills.count,
            skills.filter(\.enabled).count,
            skills.filter { $0.scope == .project }.count,
            skills.filter { $0.scope == .global || $0.scope == .system }.count
        )
    }

    func initialScan() {
        Task { await refresh(projectPath: nil) }
    }

    func refresh(projectPath: String? = nil) async {
        await runBusy { [self] in
            self.scan = try await self.service.scanProject(projectPath ?? self.scan?.projectPath)
        }
    }

    func selectProject() {
        guard let selected = service.selectFolder(title: "Select project folder") else { return }
        Task {
            await runBusy { [self] in
                self.scan = try await self.service.scanProject(selected)
                self.updateResult = nil
            }
        }
    }

    func toggle(_ skill: Skill) {
        Task {
            await runBusy { [self] in
                try await self.service.toggleSkill(
                    rootPath: skill.rootPath,
                    folderName: skill.folderName,
                    enabled: !skill.enabled,
                    readonly: skill.readonly
                )
                self.scan = try await self.service.scanProject(self.scan?.projectPath)
            }
        }
    }

    func updateProjectSkills() {
        Task {
            await runBusy { [self] in
                self.updateResult = try await self.service.updateProjectSkills(projectPath: self.scan?.projectPath)
                self.scan = try await self.service.scanProject(self.scan?.projectPath)
            }
        }
    }

    func updateGlobalSkills() {
        Task {
            await runBusy { [self] in
                self.updateResult = try await self.service.updateGlobalSkills()
                self.scan = try await self.service.scanProject(self.scan?.projectPath)
            }
        }
    }

    private func runBusy(_ operation: @escaping () async throws -> Void) async {
        busy = true
        error = nil
        do {
            try await operation()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}

struct ContentView: View {
    @StateObject private var model = AppModel()

    var body: some View {
        NavigationSplitView {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(min: 190, ideal: 220)
        } detail: {
            SkillListView(model: model)
                .navigationTitle("Skills")
                .searchable(text: $model.query, placement: .toolbar, prompt: "Search skills")
                .toolbar {
                    ToolbarItemGroup {
                        Button {
                            Task { await model.refresh() }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .disabled(model.busy)

                        Button {
                            model.selectProject()
                        } label: {
                            Label("Select Project", systemImage: "folder")
                        }
                        .disabled(model.busy)
                    }
                }
        }
        .task {
            model.initialScan()
        }
    }
}

struct SidebarView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        List {
            Section {
                Text(model.scan?.projectPath ?? "Choose a project folder.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .truncationMode(.middle)
            } header: {
                Text("Project")
            }

            if let error = model.error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            Section("Counts") {
                let counts = model.counts
                LabeledContent("Total", value: counts.all.formatted())
                LabeledContent("Enabled", value: counts.enabled.formatted())
                LabeledContent("Project", value: counts.project.formatted())
                LabeledContent("Global", value: counts.globalAndSystem.formatted())
            }

            if let budget = model.scan?.tokenBudget {
                TokenBudgetSection(budget: budget)
            }

            Section("Updates") {
                Button {
                    model.updateProjectSkills()
                } label: {
                    Label("Update Project", systemImage: "arrow.down.circle")
                }
                .disabled(model.busy || model.scan?.projectPath == nil)

                Button {
                    model.updateGlobalSkills()
                } label: {
                    Label("Update Global", systemImage: "arrow.down.circle")
                }
                .disabled(model.busy)

                if let result = model.updateResult {
                    LabeledContent("Count", value: result.updateCount?.formatted() ?? "-")
                    Text(result.output)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(8)
                        .textSelection(.enabled)
                }
            }

            Section("Skill Roots") {
                ForEach(model.scan?.skillRoots ?? []) { root in
                    VStack(alignment: .leading) {
                        Label(root.label, systemImage: root.readonly ? "lock" : "folder")
                        Text(root.path)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text(root.exists ? "Found" : "Missing")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Skills Manager")
    }
}

struct TokenBudgetSection: View {
    var budget: TokenBudget

    var body: some View {
        Section("Codex Context") {
            LabeledContent("Enabled", value: budget.enabledSkillCount.formatted())
            LabeledContent("Tokens", value: budget.registryTokens.formatted())

            HStack {
                ForEach(budget.models) { model in
                    Gauge(value: min(model.usedPercent / model.thresholdPercent, 1)) {
                        Text(model.id)
                    } currentValueLabel: {
                        Text(String(format: "%.1f", model.usedPercent))
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .tint(model.overThreshold ? .red : .accentColor)
                }
            }

            Text("2% budget, \(budget.tokenizer)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

struct SkillListView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Picker("Type", selection: $model.filter) {
                ForEach(SkillFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .padding()

            if model.filteredSkills.isEmpty {
                ContentUnavailableView("No Skills", systemImage: "square.stack.3d.up.slash")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(model.filteredSkills) { skill in
                            SkillRow(skill: skill, busy: model.busy) {
                                model.toggle(skill)
                            }
                            Divider()
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
}

struct SkillRow: View {
    var skill: Skill
    var busy: Bool
    var onToggle: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(skill.name)
                    .font(.headline)
                Text(skill.description.isEmpty ? skill.path : skill.description)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                HStack {
                    Text(skill.rootLabel)
                    if !skill.enabled {
                        Text("Disabled")
                    }
                    if skill.readonly {
                        Text("Read-only")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()

            Toggle("", isOn: Binding(
                get: { skill.enabled },
                set: { _ in onToggle() }
            ))
            .labelsHidden()
            .toggleStyle(.switch)
            .disabled(busy || skill.readonly)
        }
        .padding(.vertical, 4)
    }
}
