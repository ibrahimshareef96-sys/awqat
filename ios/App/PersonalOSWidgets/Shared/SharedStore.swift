import Darwin
import Foundation

/// The App Group's two values. The app and the extension are separate processes, so anything that reads pendingTaps and
/// writes it back holds a file lock: a tap on the widget during a drain must not be lost.
enum SharedStore {
    struct Tap: Codable, Equatable {
        let key: String
        let n: Int
    }

    private static let group = "group.app.awqat"
    private static let snapshotKey = "snapshot"
    private static let pendingKey = "pendingTaps"

    static func snapshot() -> WidgetSnapshot? {
        let defaults = UserDefaults(suiteName: group)
        defaults?.synchronize()
        return WidgetSnapshot.read(defaults?.string(forKey: snapshotKey))
    }

    static func save(snapshot json: String) {
        let defaults = UserDefaults(suiteName: group)
        defaults?.set(json, forKey: snapshotKey)
        defaults?.synchronize()
    }

    /// Taps counted on a widget or the island that the app has not taken yet.
    static func waiting(for key: String) -> Int {
        locked { readTaps().filter { $0.key == key }.reduce(0) { $0 + $1.n } }
    }

    /// Counts one tap towards `key` and returns the new count, or nil when it is already at its number.
    /// `shown` and the snapshot can each be behind (a tap on the other surface), so the higher of the two is the truth.
    static func count(key: String, shown: Int?, of: Int?) -> Int? {
        locked {
            let taps = readTaps()
            let dhikr = snapshot()?.dhikr
            let known = dhikr?.key == key ? dhikr : nil
            let waiting = taps.filter { $0.key == key }.reduce(0) { $0 + $1.n }
            let counted = max(shown ?? 0, (known?.n ?? 0) + waiting)
            if let limit = of ?? known?.of, counted >= limit { return nil }
            writeTaps(taps + [Tap(key: key, n: 1)])
            return counted + 1
        }
    }

    /// Every waiting tap, and clears them.
    static func drain() -> [Tap] {
        locked {
            let taps = readTaps()
            if !taps.isEmpty { writeTaps([]) }
            return taps
        }
    }

    private static func readTaps() -> [Tap] {
        let defaults = UserDefaults(suiteName: group)
        defaults?.synchronize()
        guard let data = defaults?.string(forKey: pendingKey)?.data(using: .utf8),
              let taps = try? JSONDecoder().decode([Tap].self, from: data) else { return [] }
        return taps
    }

    private static func writeTaps(_ taps: [Tap]) {
        guard let data = try? JSONEncoder().encode(taps), let json = String(data: data, encoding: .utf8) else { return }
        let defaults = UserDefaults(suiteName: group)
        defaults?.set(json, forKey: pendingKey)
        defaults?.synchronize()
    }

    /// Held for a moment only: a process suspended while holding a lock in a shared container gets killed.
    private static func locked<T>(_ body: () -> T) -> T {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("taps.lock") else { return body() }
        let descriptor = open(url.path, O_CREAT | O_RDWR, 0o600)
        guard descriptor >= 0 else { return body() }
        defer { close(descriptor) }
        flock(descriptor, LOCK_EX)
        defer { flock(descriptor, LOCK_UN) }
        return body()
    }
}
