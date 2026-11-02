import ActivityKit
import Capacitor
import Foundation

/// TypeScript decides what should be up; this starts, updates and ends it (docs/live-surfaces.md).
@objc(LiveBridgePlugin)
public class LiveBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveBridgePlugin"
    public let jsName = "LiveBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise)
    ]

    private static let ids: Set<String> = ["next", "dhikr", "timer"]
    /// Lines are cut, not refused: with these, title, detail, key and link stay well inside Apple's 4 KB.
    private static let titleMax = 80
    private static let detailMax = 60
    private static let keyMax = 256
    // The same shape and length Android's LiveData.isLink and the app's linkTarget accept; \z, as $ would let a
    // trailing newline through.
    private static let linkMax = 128
    private static let link = try? NSRegularExpression(pattern: "^awqat://go/[A-Za-z0-9:-]+\\z")

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["live": ActivityAuthorizationInfo().areActivitiesEnabled])
    }

    @objc func show(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), Self.ids.contains(id), let state = Self.state(from: call) else {
            call.reject("Not a live item.")
            return
        }
        LiveLine.enqueue {
            do {
                try await LiveActivities.show(id: id, wanted: state)
                call.resolve()
            } catch {
                call.reject("Could not show it: \(error.localizedDescription)")
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), Self.ids.contains(id) else {
            call.reject("Not a live item.")
            return
        }
        LiveLine.enqueue {
            await LiveActivities.end(id: id)
            call.resolve()
        }
    }

    @objc func drain(_ call: CAPPluginCall) {
        // In line with `show`: one sent just before this must still see the waiting taps it is adding to the count.
        LiveLine.enqueue {
            let taps: [[String: Any]] = SharedStore.drain().map { ["key": $0.key, "n": $0.n] }
            call.resolve(["taps": taps])
        }
    }

    private static func state(from call: CAPPluginCall) -> LiveItemAttributes.ContentState? {
        guard let title = call.getString("title"), let detail = call.getString("detail"),
              let link = call.getString("link"), isLink(link) else { return nil }
        let key = call.getString("key")
        if let key, key.isEmpty || key.utf8.count > keyMax { return nil }
        return LiveItemAttributes.ContentState(
            title: String(title.prefix(titleMax)),
            detail: String(detail.prefix(detailMax)),
            endsAt: date(call.getDouble("endsAt")),
            startedAt: date(call.getDouble("startedAt")),
            count: call.getInt("count").map { max(0, $0) },
            of: call.getInt("of").flatMap { $0 > 0 ? $0 : nil },
            key: key,
            link: link,
            countdownFrom: nil
        )
    }

    /// The only link native follows: awqat://go/<screen>.
    private static func isLink(_ text: String) -> Bool {
        guard text.utf8.count <= linkMax, let link else { return false }
        return link.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// To the whole second: nothing shown is finer, and it lets `show` tell that a time has not changed.
    private static func date(_ milliseconds: Double?) -> Date? {
        guard let milliseconds, milliseconds.isFinite, milliseconds > 0 else { return nil }
        return Date(timeIntervalSince1970: (milliseconds / 1000).rounded())
    }
}
