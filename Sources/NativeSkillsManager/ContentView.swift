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

    func updateGlobalSkills() {
        Task {
            await runBusy { [self] in
                self.updateResult = try await self.service.updateGlobalSkills()
                self.scan = try await self.service.scanProject(self.scan?.projectPath)
            }
        }
    }

    func update(_ skill: Skill) {
        Task {
            await runBusy { [self] in
                self.updateResult = try await self.service.updateSkill(skill, projectPath: self.scan?.projectPath)
                self.scan = try await self.service.scanProject(self.scan?.projectPath)
            }
        }
    }

    func remove(_ skill: Skill) {
        Task {
            busy = true
            error = nil
            do {
                updateResult = try await service.removeSkill(skill)
                scan = try await service.scanProject(scan?.projectPath)
                busy = false
            } catch {
                self.error = error.localizedDescription
                busy = false
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
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SidebarSection("Project") {
                    Text(model.scan?.projectPath ?? "Choose a project folder.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .truncationMode(.middle)
                }

                if let error = model.error {
                    SidebarSection(nil) {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }

                SidebarSection("Counts") {
                    let counts = model.counts
                    SidebarValue("Total", counts.all.formatted())
                    SidebarValue("Enabled", counts.enabled.formatted())
                    SidebarValue("Project", counts.project.formatted())
                    SidebarValue("Global", counts.globalAndSystem.formatted())
                }

                if let budget = model.scan?.tokenBudget {
                    TokenBudgetSection(budget: budget)
                }

                SidebarSection("Updates") {
                    Button {
                        model.updateGlobalSkills()
                    } label: {
                        Label("Update Global Skills", systemImage: "arrow.down.circle")
                    }
                    .disabled(model.busy)

                    if let result = model.updateResult {
                        SidebarValue("Count", result.updateCount?.formatted() ?? "-")
                        Text(result.output)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(8)
                            .textSelection(.enabled)
                    }
                }

                SidebarSection("Skill Roots") {
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
            .padding()
        }
        .navigationTitle("Skills Manager")
    }
}

struct SidebarSection<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content

    init(_ title: String?, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SidebarValue: View {
    var label: String
    var value: String

    init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
        }
    }
}

struct TokenBudgetSection: View {
    var budget: TokenBudget

    var body: some View {
        SidebarSection("Codex Context") {
            SidebarValue("Enabled", budget.enabledSkillCount.formatted())
            SidebarValue("Tokens", budget.registryTokens.formatted())

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
                            } onUpdate: {
                                model.update(skill)
                            } onDelete: {
                                model.remove(skill)
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
    @State private var confirmingDelete = false

    var skill: Skill
    var busy: Bool
    var onToggle: () -> Void
    var onUpdate: () -> Void
    var onDelete: () -> Void

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

            Button {
                onUpdate()
            } label: {
                Label("Update", systemImage: "arrow.down.circle")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.borderless)
            .disabled(busy || skill.readonly || skill.scope == .system)

            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label("Delete", systemImage: "trash")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.borderless)
            .disabled(busy || skill.readonly || skill.scope == .system)
            .confirmationDialog(
                "Delete \(skill.name)?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    onDelete()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Deletes this skill folder and related symlinks.")
            }
        }
        .padding(.vertical, 4)
    }
}
