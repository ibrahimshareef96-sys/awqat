import AppIntents
import SwiftUI
import WidgetKit

/// "Talk" in Control Center, on the Lock Screen or the Action button (iOS 18): one press opens the app on Talk.
@available(iOS 18.0, *)
struct TalkControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: WidgetKinds.talk) {
            ControlWidgetButton(action: OpenTalkIntent()) {
                Label("Talk", systemImage: "mic")
            }
        }
        .displayName("Talk to Awqat")
        .description("Opens Talk in Awqat.")
    }
}
