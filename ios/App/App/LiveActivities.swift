import ActivityKit
import Foundation

/// The app's side of ActivityKit. Every call here runs on `LiveLine`.
enum LiveActivities {
    private typealias State = LiveItemAttributes.ContentState

    /// Starts it, or updates the one up with this id only if its content changed, so the island never flashes.
    static func show(id: String, wanted: LiveItemAttributes.ContentState) async throws {
        let up = LiveItemAttributes.up(id: id)
        let shown = withWaitingTaps(wanted, id: id)
        if shown.isFull {
            // At its number a dhikr ends itself, and one the app has not caught up on is never started full.
            await up?.end(LiveItemAttributes.content(id: id, state: shown), dismissalPolicy: .immediate)
            return
        }
        if let up {
            let current = LiveItemAttributes.state(of: up)
            let next = withCountdownStart(shown, current: current)
            if next != current {
                await LiveItemAttributes.send(next, to: up)
            }
            return
        }
        let content = LiveItemAttributes.content(id: id, state: withCountdownStart(shown, current: nil))
        _ = try Activity.request(attributes: LiveItemAttributes(id: id), content: content, pushType: nil)
    }

    static func end(id: String) async {
        await LiveItemAttributes.up(id: id)?.end(nil, dismissalPolicy: .immediate)
    }

    /// Taps the app has not drained yet are not in its count. Adding them means a `show` that runs before a drain does
    /// not rewind what the user just tapped, and the one after it finds nothing changed.
    private static func withWaitingTaps(_ state: State, id: String) -> State {
        guard id == "dhikr", let key = state.key, let count = state.count else { return state }
        let waiting = SharedStore.waiting(for: key)
        let total = count + waiting
        return waiting == 0 ? state : state.counted(state.of.map { min($0, total) } ?? total)
    }

    /// A ring starts where its countdown was first shown, and keeps that start until the time it runs to changes.
    private static func withCountdownStart(_ state: State, current: State?) -> State {
        var next = state
        if state.endsAt == nil {
            next.countdownFrom = nil
        } else if let current, current.endsAt == state.endsAt {
            next.countdownFrom = current.countdownFrom
        } else {
            next.countdownFrom = Date()
        }
        return next
    }
}
