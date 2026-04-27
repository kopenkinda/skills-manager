import AppKit
import Darwin
import Foundation

final class SkillService: @unchecked Sendable {
    private let fileManager = FileManager.default
    private let skillContextModels: [(id: String, contextWindow: Int)] = [
        ("gpt-5.4", 400_000),
        ("gpt-5.5", 1_000_000),
    ]
    private let thresholdPercent = 2.0

    @MainActor
    func selectFolder(title: String, defaultPath: String? = nil) -> String? {
        let panel = NSOpenPanel()
        panel.title = title
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        if let defaultPath {
            panel.directoryURL = URL(fileURLWithPath: defaultPath)
        }
        return panel.runModal() == .OK ? panel.url?.path : nil
    }

    func scanProject(_ projectPath: String?) async throws -> ScanResult {
        let normalizedProject = projectPath.map { URL(fileURLWithPath: $0).standardizedFileURL.path }
        let roots = skillRoots(projectPath: normalizedProject)
        let skills = try await withThrowingTaskGroup(of: [Skill].self) { group in
            for root in roots {
                group.addTask { try await self.scanSkillRoot(root) }
            }
            var all: [Skill] = []
            for try await chunk in group {
                all.append(contentsOf: chunk)
            }
            return all.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }

        return ScanResult(
            projectPath: normalizedProject,
            skillRoots: roots.map { root in
                SkillRoot(
                    label: root.label,
                    path: root.path,
                    scope: root.scope,
                    exists: fileManager.fileExists(atPath: root.path),
                    readonly: root.readonly
                )
            },
            skills: skills,
            tokenBudget: countSkillRegistryTokens(skills)
        )
    }

    func toggleSkill(rootPath: String, folderName: String, enabled: Bool, readonly: Bool) async throws {
        if readonly {
            throw SkillError.message("This skill root is read-only.")
        }

        let rootPath = standard(rootPath)
        let currentPath = standard(rootPath + "/" + folderName)
        let skillName = skillBaseName(folderName)
        let disabledRoot = disabledRoot(rootPath)
        let nextPath = standard(enabled ? "\(rootPath)/\(skillName)" : "\(disabledRoot)/\(skillName)")

        guard isInsideOrSame(parent: rootPath, child: currentPath),
              isInsideOrSame(parent: rootPath, child: nextPath) else {
            throw SkillError.message("Invalid skill path.")
        }
        guard pathExists(currentPath) else {
            throw SkillError.message("Skill folder no longer exists.")
        }

        let conflictStamp = conflictStamp()
        try createDirectory(dirname(nextPath))
        try archivePathIfExists(nextPath, stamp: conflictStamp)

        let symlinks = try await findSkillSymlinks(skillPath: currentPath, rootPath: rootPath)
        for link in symlinks {
            let nextLinkPath = nextSymlinkPath(path: link.path, skillName: skillName, enabled: enabled)
            if nextLinkPath != link.path {
                try createDirectory(dirname(nextLinkPath))
                try archivePathIfExists(nextLinkPath, stamp: conflictStamp)
            }
        }

        let changedSymlinks = try renameSkillSymlinks(symlinks, currentPath: currentPath, nextPath: nextPath, enabled: enabled)
        do {
            try fileManager.moveItem(atPath: currentPath, toPath: nextPath)
        } catch {
            try? restoreSkillSymlinks(changedSymlinks)
            throw error
        }
    }

    func updateProjectSkills(projectPath: String?) async throws -> UpdateResult {
        guard let projectPath else {
            throw SkillError.message("Select a project before updating project skills.")
        }
        let output = try await runSkillsCli(args: ["skills", "update", "--project"], projectPath: projectPath)
        return parseUpdateOutput(output, command: "pnpx skills update --project")
    }

    func updateGlobalSkills() async throws -> UpdateResult {
        let output = try await runSkillsCli(args: ["skills", "update", "--global"], projectPath: nil)
        return parseUpdateOutput(output, command: "pnpx skills update --global")
    }

    private struct Root {
        var label: String
        var path: String
        var scope: SkillScope
        var readonly: Bool
    }

    private func skillRoots(projectPath: String?) -> [Root] {
        var roots: [Root] = []
        if let projectPath {
            roots.append(Root(label: "Project .agent", path: "\(projectPath)/.agent/skills", scope: .project, readonly: false))
            roots.append(Root(label: "Project .agents", path: "\(projectPath)/.agents/skills", scope: .project, readonly: false))
        }
        let home = NSHomeDirectory()
        roots.append(Root(label: "Global agents", path: "\(home)/.agents/skills", scope: .global, readonly: false))
        roots.append(Root(label: "Codex system", path: "\(home)/.codex/skills/.system", scope: .system, readonly: true))
        return roots
    }

    private func scanSkillRoot(_ root: Root) async throws -> [Skill] {
        guard pathExists(root.path) else { return [] }
        let enabled = try scanSkillDirectory(root: root, directory: root.path, enabled: true)
        let disabled = try scanSkillDirectory(root: root, directory: disabledRoot(root.path), enabled: false)
        let legacy = try scanLegacyDisabledSkillDirectory(root)
        return dedupeSkillRows(enabled + disabled + legacy)
    }

    private func scanSkillDirectory(root: Root, directory: String, enabled: Bool) throws -> [Skill] {
        guard pathExists(directory) else { return [] }
        return try directoryNames(directory).compactMap { name in
            guard name != ".disabled", !isArchivedConflictName(name) else { return nil }
            let skillPath = "\(directory)/\(name)"
            let skillFile = "\(skillPath)/SKILL.md"
            guard pathExists(skillFile) else { return nil }
            let source = try String(contentsOfFile: skillFile, encoding: .utf8)
            let frontmatter = parseFrontmatter(source)
            let skillName = skillBaseName(name)
            return Skill(
                id: "\(root.path):\(enabled ? "" : ".disabled/")\(name)",
                name: frontmatter.name ?? skillName,
                folderName: enabled ? name : ".disabled/\(name)",
                description: frontmatter.description ?? "",
                scope: root.scope,
                rootLabel: root.label,
                rootPath: root.path,
                path: skillPath,
                enabled: enabled,
                readonly: root.readonly
            )
        }
    }

    private func scanLegacyDisabledSkillDirectory(_ root: Root) throws -> [Skill] {
        try directoryNames(root.path).compactMap { name in
            guard name.hasSuffix(".disabled"), !isArchivedConflictName(name) else { return nil }
            let skillPath = "\(root.path)/\(name)"
            let skillFile = "\(skillPath)/SKILL.md"
            let disabledSkillFile = "\(skillPath)/SKILL.md.disabled"
            let readable = pathExists(skillFile) ? skillFile : (pathExists(disabledSkillFile) ? disabledSkillFile : nil)
            guard let readable else { return nil }
            let source = try String(contentsOfFile: readable, encoding: .utf8)
            let frontmatter = parseFrontmatter(source)
            let skillName = skillBaseName(name)
            return Skill(
                id: "\(root.path):\(name)",
                name: frontmatter.name ?? skillName,
                folderName: name,
                description: frontmatter.description ?? "",
                scope: root.scope,
                rootLabel: root.label,
                rootPath: root.path,
                path: skillPath,
                enabled: false,
                readonly: root.readonly
            )
        }
    }

    private func dedupeSkillRows(_ skills: [Skill]) -> [Skill] {
        var byName: [String: Skill] = [:]
        for skill in skills {
            let key = skillBaseName(skill.folderName)
            if byName[key] == nil || (byName[key]?.enabled == false && skill.enabled) {
                byName[key] = skill
            }
        }
        return byName.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func countSkillRegistryTokens(_ skills: [Skill]) -> TokenBudget {
        let enabledSkills = skills.filter(\.enabled)
        let registryText = enabledSkills.map {
            "name: \($0.name)\ndescription: \($0.description)\npath: \($0.path)\nscope: \($0.scope.rawValue)"
        }.joined(separator: "\n\n")
        let registryTokens = max(0, Int((Double(registryText.utf8.count) / 3.7).rounded()))

        return TokenBudget(
            tokenizer: "native estimate",
            enabledSkillCount: enabledSkills.count,
            registryTokens: registryTokens,
            models: skillContextModels.map { model in
                let thresholdTokens = Int(Double(model.contextWindow) * thresholdPercent / 100)
                return TokenBudget.Model(
                    id: model.id,
                    contextWindow: model.contextWindow,
                    thresholdPercent: thresholdPercent,
                    thresholdTokens: thresholdTokens,
                    usedPercent: Double(registryTokens) / Double(model.contextWindow) * 100,
                    overThreshold: registryTokens > thresholdTokens
                )
            }
        )
    }

    private func parseFrontmatter(_ source: String) -> (name: String?, description: String?) {
        guard source.hasPrefix("---"), let end = source[source.index(source.startIndex, offsetBy: 3)...].range(of: "\n---")?.lowerBound else {
            return (nil, nil)
        }
        let body = source[source.index(source.startIndex, offsetBy: 3)..<end]
        var fields: [String: String] = [:]
        for line in body.split(whereSeparator: \.isNewline) {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = String(line[..<colon]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(line[line.index(after: colon)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            fields[key] = value
        }
        return (fields["name"], fields["description"])
    }

    private func findSkillSymlinks(skillPath: String, rootPath: String) async throws -> [SkillSymlink] {
        let roots = try await candidateSkillDirs(rootPath: rootPath)
        let resolvedSkillPath = standard(skillPath)
        var symlinks: [SkillSymlink] = []

        for root in roots {
            for directory in [root, disabledRoot(root)] where pathExists(directory) {
                for name in try directoryNames(directory, includeSymlinks: true) {
                    let entryPath = "\(directory)/\(name)"
                    guard isSymlink(entryPath) else { continue }
                    let linkTarget = try fileManager.destinationOfSymbolicLink(atPath: entryPath)
                    let absoluteTarget = linkTarget.hasPrefix("/")
                        ? standard(linkTarget)
                        : standard("\(dirname(entryPath))/\(linkTarget)")
                    if absoluteTarget == resolvedSkillPath {
                        symlinks.append(SkillSymlink(path: entryPath, linkTarget: linkTarget))
                    }
                }
            }
        }
        return symlinks
    }

    private func candidateSkillDirs(rootPath: String) async throws -> [String] {
        let home = NSHomeDirectory()
        var dirs = Set([
            "\(home)/.agents/skills",
            "\(home)/.config/agents/skills",
            "\(home)/.codex/skills",
            "\(home)/.claude/skills",
            "\(home)/.cursor/skills",
            "\(home)/.gemini/antigravity/skills",
            "\(home)/.gemini/skills",
            "\(home)/.config/opencode/skills",
            "\(home)/.copilot/skills",
        ])
        for dir in try discoverSkillDirs(base: home, maxDepth: 4) {
            dirs.insert(dir)
        }
        if let projectRoot = projectRootFromSkillRoot(rootPath) {
            for dir in [
                "\(projectRoot)/.agent/skills",
                "\(projectRoot)/.agents/skills",
                "\(projectRoot)/.claude/skills",
                "\(projectRoot)/.cursor/skills",
                "\(projectRoot)/.codex/skills",
            ] {
                dirs.insert(dir)
            }
        }
        dirs.insert(rootPath)
        return Array(dirs)
    }

    private func discoverSkillDirs(base: String, maxDepth: Int) throws -> [String] {
        let ignored = Set([".cache", ".npm", ".pnpm-store", ".Trash", ".vscode", "Library", "node_modules"])
        var found: [String] = []

        func walk(_ dir: String, depth: Int) throws {
            guard depth <= maxDepth, pathExists(dir) else { return }
            let names = (try? directoryNames(dir)) ?? []
            for name in names where !ignored.contains(name) {
                if depth == 0 && !name.hasPrefix(".") { continue }
                let entryPath = "\(dir)/\(name)"
                guard isDirectory(entryPath) else { continue }
                if name == "skills" {
                    found.append(entryPath)
                    continue
                }
                try walk(entryPath, depth: depth + 1)
            }
        }

        try walk(base, depth: 0)
        return found
    }

    private func renameSkillSymlinks(
        _ symlinks: [SkillSymlink],
        currentPath: String,
        nextPath: String,
        enabled: Bool
    ) throws -> [(link: SkillSymlink, nextPath: String)] {
        var changed: [(SkillSymlink, String)] = []
        let skillName = skillBaseName(basename(nextPath))

        for link in symlinks {
            let nextLinkPath = nextSymlinkPath(path: link.path, skillName: skillName, enabled: enabled)
            let nextTarget = rewriteSymlinkTarget(link: link, currentPath: currentPath, nextPath: nextPath)

            do {
                try createDirectory(dirname(nextLinkPath))
                try? fileManager.removeItem(atPath: link.path)
                try fileManager.createSymbolicLink(atPath: nextLinkPath, withDestinationPath: nextTarget)
                changed.append((link, nextLinkPath))
            } catch {
                try? restoreSkillSymlinks(changed)
                throw error
            }
        }
        return changed
    }

    private func restoreSkillSymlinks(_ symlinks: [(link: SkillSymlink, nextPath: String)]) throws {
        for item in symlinks.reversed() {
            if pathExistsNoFollow(item.nextPath) {
                try? fileManager.removeItem(atPath: item.nextPath)
            }
            if !pathExistsNoFollow(item.link.path) {
                try fileManager.createSymbolicLink(atPath: item.link.path, withDestinationPath: item.link.linkTarget)
            }
        }
    }

    private func rewriteSymlinkTarget(link: SkillSymlink, currentPath: String, nextPath: String) -> String {
        if link.linkTarget.hasPrefix("/") { return nextPath }
        let currentTarget = standard("\(dirname(link.path))/\(link.linkTarget)")
        if currentTarget != standard(currentPath) {
            return link.linkTarget
        }
        return relativePath(from: dirname(link.path), to: nextPath)
    }

    private func archivePathIfExists(_ path: String, stamp: String) throws {
        guard pathExistsNoFollow(path) else { return }
        var archivedPath = "\(path).conflict-\(stamp)"
        var index = 1
        while pathExistsNoFollow(archivedPath) {
            archivedPath = "\(path).conflict-\(stamp)-\(index)"
            index += 1
        }
        try fileManager.moveItem(atPath: path, toPath: archivedPath)
    }

    private func runSkillsCli(args: [String], projectPath: String?) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["pnpx"] + args
            process.currentDirectoryURL = URL(fileURLWithPath: projectPath ?? NSHomeDirectory())
            var env = ProcessInfo.processInfo.environment
            env.removeValue(forKey: "ELECTRON_RUN_AS_NODE")
            process.environment = env

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            process.terminationHandler = { proc in
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8) ?? ""
                if proc.terminationStatus == 0 {
                    continuation.resume(returning: Self.stripAnsi(output))
                } else {
                    let cleaned = Self.stripAnsi(output)
                    continuation.resume(throwing: SkillError.message(cleaned.isEmpty ? "pnpx failed." : cleaned))
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    private func parseUpdateOutput(_ output: String, command: String) -> UpdateResult {
        var updates: [(name: String, source: String?)] = []
        let lines = output.components(separatedBy: .newlines)
        for (index, rawLine) in lines.enumerated() {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard line.hasPrefix("↑") else { continue }
            let name = line.dropFirst().trimmingCharacters(in: .whitespacesAndNewlines)
            let next = index + 1 < lines.count ? lines[index + 1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
            let source = next.hasPrefix("source:") ? String(next.dropFirst("source:".count)).trimmingCharacters(in: .whitespacesAndNewlines) : nil
            updates.append((name, source))
        }
        let count = firstRegexInt(output, pattern: #"Found\s+(\d+)\s+update\(s\)"#)
            ?? firstRegexInt(output, pattern: #"(\d+)\s+update\(s\)\s+available"#)
            ?? updates.count
        return UpdateResult(command: command, output: output, updateCount: count, updates: updates)
    }

    private func firstRegexInt(_ text: String, pattern: String) -> Int? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return Int(text[range])
    }

    private func skillBaseName(_ name: String) -> String {
        var normalized = name.hasPrefix(".disabled/") ? String(name.dropFirst(".disabled/".count)) : name
        if normalized.hasSuffix(".disabled") {
            normalized.removeLast(".disabled".count)
        }
        if let regex = try? NSRegularExpression(pattern: #"\.conflict-\d{14}(?:-\d+)?(?:\.disabled)?$"#) {
            normalized = regex.stringByReplacingMatches(
                in: normalized,
                range: NSRange(normalized.startIndex..., in: normalized),
                withTemplate: ""
            )
        }
        return normalized
    }

    private func isArchivedConflictName(_ name: String) -> Bool {
        firstRegexInt(name, pattern: #"\.conflict-(\d{14})(?:-\d+)?(?:\.disabled)?$"#) != nil
    }

    private func disabledRoot(_ rootPath: String) -> String {
        "\(rootPath)/.disabled"
    }

    private func symlinkRoot(_ path: String) -> String {
        let parent = dirname(path)
        return basename(parent) == ".disabled" ? dirname(parent) : parent
    }

    private func nextSymlinkPath(path: String, skillName: String, enabled: Bool) -> String {
        let root = symlinkRoot(path)
        return standard(enabled ? "\(root)/\(skillName)" : "\(root)/.disabled/\(skillName)")
    }

    private func projectRootFromSkillRoot(_ rootPath: String) -> String? {
        let normalized = standard(rootPath)
        for suffix in ["/.agent/skills", "/.agents/skills", "/.claude/skills", "/.cursor/skills", "/.codex/skills"] {
            if normalized.hasSuffix(suffix) {
                return String(normalized.dropLast(suffix.count))
            }
        }
        return nil
    }

    private func isInsideOrSame(parent: String, child: String) -> Bool {
        let parentURL = URL(fileURLWithPath: parent).standardizedFileURL
        let childURL = URL(fileURLWithPath: child).standardizedFileURL
        let parentComponents = parentURL.pathComponents
        let childComponents = childURL.pathComponents
        return childComponents.count >= parentComponents.count
            && Array(childComponents.prefix(parentComponents.count)) == parentComponents
    }

    private func directoryNames(_ path: String, includeSymlinks: Bool = false) throws -> [String] {
        try fileManager.contentsOfDirectory(atPath: path).filter { name in
            let full = "\(path)/\(name)"
            return includeSymlinks ? true : isDirectory(full)
        }
    }

    private func isDirectory(_ path: String) -> Bool {
        var isDir: ObjCBool = false
        return fileManager.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue
    }

    private func pathExists(_ path: String) -> Bool {
        fileManager.fileExists(atPath: path)
    }

    private func pathExistsNoFollow(_ path: String) -> Bool {
        var statBuffer = stat()
        return lstat(path, &statBuffer) == 0
    }

    private func isSymlink(_ path: String) -> Bool {
        var statBuffer = stat()
        guard lstat(path, &statBuffer) == 0 else { return false }
        return (statBuffer.st_mode & S_IFMT) == S_IFLNK
    }

    private func createDirectory(_ path: String) throws {
        try fileManager.createDirectory(atPath: path, withIntermediateDirectories: true)
    }

    private func standard(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.path
    }

    private func dirname(_ path: String) -> String {
        URL(fileURLWithPath: path).deletingLastPathComponent().path
    }

    private func basename(_ path: String) -> String {
        URL(fileURLWithPath: path).lastPathComponent
    }

    private func relativePath(from base: String, to target: String) -> String {
        let baseComponents = URL(fileURLWithPath: base).standardizedFileURL.pathComponents
        let targetComponents = URL(fileURLWithPath: target).standardizedFileURL.pathComponents
        var index = 0
        while index < baseComponents.count,
              index < targetComponents.count,
              baseComponents[index] == targetComponents[index] {
            index += 1
        }
        let parts = Array(repeating: "..", count: baseComponents.count - index) + targetComponents.dropFirst(index)
        return parts.joined(separator: "/")
    }

    private func conflictStamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMddHHmmss"
        return formatter.string(from: Date())
    }

    private static func stripAnsi(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"\u{001B}\[[0-9;]*[A-Za-z]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "\r", with: "\n")
    }
}

enum SkillError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let message): message
        }
    }
}
