import UIKit
import Capacitor

/// Capacitor finds plugins that come from packages by itself. These two live in the app target, so they are handed to
/// the bridge here, before the page loads.
class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveBridgePlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}
