import AppIntents
import UIKit

/// Siri and Shortcuts through App Intents, on the phone, with no per-call service (docs/live-surfaces.md). Two phrases
/// open the app through the same checked links a widget sends; the third answers in Siri's own reply from the App Group
/// snapshot, and the app stays closed.

/// "Talk to Awqat": the app opens on the Talk sheet, which waits for its Talk button (a link never turns the
/// microphone on).
struct TalkToAwqatIntent: AppIntent {
    static let title: LocalizedStringResource = "Talk to Awqat"
    static let description = IntentDescription("Opens Talk in Awqat.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        await AppLink.open(WidgetLinks.talk)
        return .result()
    }
}

/// "Open adhkar in Awqat": the set open now, or the one that opens next (the app picks it).
struct OpenAdhkarIntent: AppIntent {
    static let title: LocalizedStringResource = "Open adhkar"
    static let description = IntentDescription("Opens the morning or evening adhkar in Awqat.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        await AppLink.open(WidgetLinks.adhkar)
        return .result()
    }
}

/// "When is the next prayer in Awqat": the next prayer's name and time, said by Siri, from the snapshot the app last
/// wrote. A guessed place's times are Makkah's, so then it says the place is not set.
struct NextPrayerIntent: AppIntent {
    static let title: LocalizedStringResource = "Next prayer"
    static let description = IntentDescription("Says when the next prayer is, from Awqat's prayer times.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let answer = NextPrayerAnswer.text(SharedStore.snapshot(), now: Date())
        return .result(dialog: "\(answer)")
    }
}

/// What Siri says for the next prayer. Plain words, the prayer's name and time as the app wrote them.
enum NextPrayerAnswer {
    static func text(_ snapshot: WidgetSnapshot?, now: Date) -> String {
        guard let snapshot else { return "Open Awqat once, so it can work out your prayer times." }
        if snapshot.placeUnset { return "Your place is not set in Awqat yet, so there is no prayer time to give." }
        guard let next = snapshot.prayers.filter({ $0.date > now }).min(by: { $0.at < $1.at }) else {
            return "Open Awqat once, so it can bring your prayer times up to date."
        }
        return "\(next.name) is at \(next.time)."
    }
}

/// Opens one of the app's own links, which comes back to it as a widget tap does.
enum AppLink {
    @MainActor
    static func open(_ url: URL?) async {
        guard let url else { return }
        _ = await UIApplication.shared.open(url)
    }
}

/// The phrases. Each names the app, as App Intents requires.
struct AwqatShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: TalkToAwqatIntent(), phrases: [
            "Talk to \(.applicationName)",
            "Open Talk in \(.applicationName)",
        ], shortTitle: "Talk", systemImageName: "mic")
        AppShortcut(intent: OpenAdhkarIntent(), phrases: [
            "Open adhkar in \(.applicationName)",
            "Open the adhkar in \(.applicationName)",
        ], shortTitle: "Adhkar", systemImageName: "sun.max")
        AppShortcut(intent: NextPrayerIntent(), phrases: [
            "When is the next prayer in \(.applicationName)",
            "Next prayer in \(.applicationName)",
        ], shortTitle: "Next prayer", systemImageName: "clock")
    }
}
