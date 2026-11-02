import Foundation

/// What the app last handed over (docs/live-surfaces.md). Decoding fails rather than guesses: a snapshot that does not
/// read shows the calm "Open the app once" state, never a crash. Everything added after the first widgets is optional,
/// so a snapshot from an older app still reads.
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
        /// Today's reading against the goal ("3 of 5 pages today").
        let read: String?
    }

    struct Dhikr: Decodable {
        let key: String
        let name: String
        let n: Int
        let of: Int
    }

    /// One prayer day, Fajr to Fajr, with its five prayers and its Hijri date.
    struct PrayerDay: Decodable {
        struct Hijri: Decodable {
            let text: String
            let day: Int
            let month: String
        }

        struct Prayer: Decodable {
            let name: String
            let time: String
            let at: Double
            /// When its time is over; absent when the app could not tell.
            let until: Double?
            let iqama: Double?
            let iqamaTime: String?

            var date: Date { Date(timeIntervalSince1970: at / 1000) }
            var end: Date? { until.map { Date(timeIntervalSince1970: $0 / 1000) } }
            var iqamaDate: Date? { iqama.map { Date(timeIntervalSince1970: $0 / 1000) } }
        }

        let date: String
        let hijri: Hijri?
        let prayers: [Prayer]
    }

    /// When the morning and evening adhkar are open on one prayer day, and whether each is said in full.
    struct AdhkarDay: Decodable {
        struct Window: Decodable {
            let from: Double
            let to: Double
            let said: Bool

            var start: Date { Date(timeIntervalSince1970: from / 1000) }
            var end: Date { Date(timeIntervalSince1970: to / 1000) }
        }

        let date: String
        let morning: Window
        let evening: Window
    }

    /// A meeting today or tomorrow. Its title is private: home-screen widgets only, never the Lock Screen.
    struct Meeting: Decodable {
        let title: String
        let date: String
        let time: String
        let start: Double
        let end: Double
        let before: String?
        let after: String?

        var startDate: Date { Date(timeIntervalSince1970: start / 1000) }
        var endDate: Date { Date(timeIntervalSince1970: end / 1000) }
    }

    let v: Int
    let tz: String
    let prayers: [Prayer]
    let days: [Day]
    let dhikr: Dhikr?
    let steps: String?
    /// "unset" while the place is only guessed: then nothing from the prayer times comes at all.
    let place: String?
    let prayerDays: [PrayerDay]?
    let adhkar: [AdhkarDay]?
    let calendar: Bool?
    let meetings: [Meeting]?

    var placeUnset: Bool { place == "unset" }

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
    static let prayerDay = "app.awqat.widgets.prayerDay"
    static let quran = "app.awqat.widgets.quran"
    static let adhkar = "app.awqat.widgets.adhkar"
    static let agenda = "app.awqat.widgets.agenda"
    static let hijri = "app.awqat.widgets.hijri"
    static let talk = "app.awqat.widgets.talk"
}

/// The only links the widgets, the Talk control and the app's intents open: awqat://go/<screen>, which the app follows
/// only for the screens these send (src/app/widget.ts, linkTarget).
enum WidgetLinks {
    static let faith = URL(string: "awqat://go/faith")
    static let home = URL(string: "awqat://go/home")
    static let mushaf = URL(string: "awqat://go/mushaf")
    static let revise = URL(string: "awqat://go/revise")
    static let modes = URL(string: "awqat://go/modes")
    static let adhkar = URL(string: "awqat://go/adhkar")
    static let agenda = URL(string: "awqat://go/agenda")
    static let talk = URL(string: "awqat://go/talk")
}
