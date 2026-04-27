import SwiftUI

@main
struct NativeSkillsManagerApp: App {
    var body: some Scene {
        WindowGroup("Skills Manager") {
            ContentView()
                .frame(minWidth: 980, minHeight: 680)
        }
        .windowResizability(.contentMinSize)
    }
}
