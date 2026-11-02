import ActivityKit
import Foundation

/// The one Live Activity type. Everything but the id is content state, so `show` can change any of it without
/// restarting the activity, which would make the island flash. In both targets: the app starts it, the extension draws it.
struct LiveItemAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var title: String
        var detail: String
        var endsAt: Date?
        var startedAt: Date?
        var count: Int?
        var of: Int?
        var key: String?
        var link: String
        /// When this countdown was first shown: where the minimal island's ring starts. Native's own, not in the contract.
        var countdownFrom: Date?
    }

    let id: String

    /// The activity up with this id. One the system has ended or the user has dismissed does not count.
    static func up(id: String) -> Activity<LiveItemAttributes>? {
        Activity<LiveItemAttributes>.activities.first {
            $0.attributes.id == id && ($0.activityState == .active || $0.activityState == .stale)
        }
    }

    /// The island shows one activity of an app, the highest scored: what the user started personally comes before the prayer
    /// countdown, and the count the user is tapping before anything.
    static func content(id: String, state: ContentState) -> ActivityContent<ContentState> {
        let relevance: Double = id == "dhikr" ? 100 : id == "timer" ? 50 : 10
        // Past its time, with the app closed, a countdown can only sit at zero: stale lets the view dim it.
        return ActivityContent(state: state, staleDate: state.endsAt, relevanceScore: relevance)
    }

    /// Only ever touched on `LiveLine`, by activity. See `state(of:)`.
    private static var sent: [String: ContentState] = [:]

    /// What is on screen. ActivityKit's copy lags an update that has just returned, so a second quick tap would count
    /// from the same number; what this process last sent comes first.
    static func state(of activity: Activity<LiveItemAttributes>) -> ContentState {
        sent[activity.id] ?? activity.content.state
    }

    static func send(_ state: ContentState, to activity: Activity<LiveItemAttributes>) async {
        sent[activity.id] = state
        await activity.update(content(id: activity.attributes.id, state: state))
    }
}

/// Calls that touch an activity run strictly one after another. Quick taps reach `perform()` at the same instant and
/// `show` is called often, so without this an older count could land last, or two calls could each start an activity.
enum LiveLine {
    private static let lock = NSLock()
    private static var last: Task<Void, Never>?

    @discardableResult
    static func enqueue(_ work: @escaping () async -> Void) -> Task<Void, Never> {
        lock.lock()
        defer { lock.unlock() }
        let previous = last
        let task = Task {
            await previous?.value
            await work()
        }
        last = task
        return task
    }
}

extension LiveItemAttributes.ContentState {
    var isFull: Bool {
        guard let count, let of else { return false }
        return count >= of
    }

    /// A copy at a new count. The detail moves with it only if it was the count in words, as the app writes it.
    func counted(_ newCount: Int) -> Self {
        var next = self
        if let count, let of, detail == "\(count) of \(of)" {
            next.detail = "\(newCount) of \(of)"
        }
        next.count = newCount
        return next
    }
}
