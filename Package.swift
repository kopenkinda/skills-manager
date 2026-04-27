// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NativeSkillsManager",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "NativeSkillsManager", targets: ["NativeSkillsManager"])
    ],
    targets: [
        .executableTarget(
            name: "NativeSkillsManager",
            path: "Sources/NativeSkillsManager"
        )
    ]
)
