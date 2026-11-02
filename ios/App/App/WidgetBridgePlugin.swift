import Capacitor
import Foundation
import WidgetKit

/// The app hands the widgets what they show. As on Android: one method, one fixed place to keep it, and nothing from the
/// page chooses a file name or a key.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    /// About 60 prayers, 12 prayer days, the adhkar and 8 meetings come to some 15 KB; past this it is not a snapshot.
    private static let snapshotMax = 100_000

    @objc func update(_ call: CAPPluginCall) {
        guard let snapshot = call.getString("snapshot"), snapshot.utf16.count <= Self.snapshotMax else {
            call.reject("No snapshot, or one too large.")
            return
        }
        guard let data = snapshot.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              (root["v"] as? Int) == 1 else {
            call.reject("Not a snapshot this widget reads.")
            return
        }
        SharedStore.save(snapshot: snapshot)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
