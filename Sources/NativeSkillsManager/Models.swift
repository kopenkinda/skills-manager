import Foundation

enum SkillScope: String, CaseIterable, Identifiable {
    case project
    case global
    case system

    var id: String { rawValue }

    var label: String {
        switch self {
        case .project: "Project"
        case .global: "Global"
        case .system: "System"
        }
    }
}

enum SkillFilter: String, CaseIterable, Identifiable {
    case all
    case project
    case global
    case system

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All"
        case .project: "Project"
        case .global: "Global"
        case .system: "System"
        }
    }
}

struct Skill: Identifiable, Hashable {
    var id: String
    var name: String
    var folderName: String
    var description: String
    var scope: SkillScope
    var rootLabel: String
    var rootPath: String
    var path: String
    var enabled: Bool
    var readonly: Bool
}

struct SkillRoot: Identifiable, Hashable {
    var id: String { path }
    var label: String
    var path: String
    var scope: SkillScope
    var exists: Bool
    var readonly: Bool
}

struct ScanResult {
    var projectPath: String?
    var skillRoots: [SkillRoot]
    var skills: [Skill]
    var tokenBudget: TokenBudget
}

struct TokenBudget {
    struct Model: Identifiable {
        var id: String
        var contextWindow: Int
        var thresholdPercent: Double
        var thresholdTokens: Int
        var usedPercent: Double
        var overThreshold: Bool
    }

    var tokenizer: String
    var enabledSkillCount: Int
    var registryTokens: Int
    var models: [Model]
}

struct UpdateResult {
    var command: String
    var output: String
    var updateCount: Int?
    var updates: [(name: String, source: String?)]
}

struct SkillSymlink {
    var path: String
    var linkTarget: String
}
