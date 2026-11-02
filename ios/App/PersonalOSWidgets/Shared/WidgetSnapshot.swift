import Foundation

/// What the app last handed over (docs/live-surfaces.md). Decoding fails rather than guesses: a snapshot that does not
/// read shows the calm "Open the app once" state, never a crash.
struct WidgetSnapshot: Decodable {
    struct Prayer: Decodable {
        let name: String
        let time: String
        let at: Double

        var date: Date { Date(timeIntervalSince1970: at / 1000) }
    }

    struct Day: Decodable {
        let date: String
        let quran: String
        let revise: String
    }

    struct Dhikr: Decodable {
        let key: String
        let name: String
        let n: Int
        let of: Int
    }

    let v: Int
    let tz: String
    let prayers: [Prayer]
    let days: [Day]
    let dhikr: Dhikr?
    let steps: String?

    static func read(_ json: String?) -> WidgetSnapshot? {
        guard let data = json?.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
              snapshot.v == 1 else { return nil }
        return snapshot
    }
}

/// The widgets' kinds, so a tap in the app's process can reload the one that shows the count.
enum WidgetKinds {
    static let nextPrayer = "app.awqat.widgets.nextPrayer"
    static let dhikr = "app.awqat.widgets.dhikr"
}
