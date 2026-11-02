import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var waiting: (session: UISceneSession, options: UIScene.ConnectionOptions)?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // A + on a Live Activity launches the app in the background. The tap needs only the shared store, so the page
        // does not load, or run, until the user actually comes to the app: the tap is quicker, and the page wakes only in front.
        if UIApplication.shared.applicationState == .background {
            waiting = (session, connectionOptions)
        } else {
            attach(scene, session: session, options: connectionOptions)
        }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        attachIfWaiting(scene)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        attachIfWaiting(scene)
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    private func attachIfWaiting(_ scene: UIScene) {
        guard let waiting else { return }
        self.waiting = nil
        attach(scene, session: waiting.session, options: waiting.options)
    }

    private func attach(_ scene: UIScene, session: UISceneSession, options: UIScene.ConnectionOptions) {
        window?.rootViewController = BridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: options)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        attachIfWaiting(scene)
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
