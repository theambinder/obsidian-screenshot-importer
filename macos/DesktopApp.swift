import AppKit
import WebKit

final class DesktopApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var imageWindows: [NSWindow] = []
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var logHandle: FileHandle?
    private var outputBuffer = Data()
    private var baseURL: URL?
    private var locations: [String: String] = [:]
    private var locationFields: [NSTextField] = []
    private var pendingLocations: [String: String] = [:]
    private var stoppingFor: String?
    private var startupError: String?
    private var statusPanel: NSPanel?
    private let locationKeys = ["screenshotsRoot", "vaultRoot", "mediaRoot", "dataDir"]
    private let locationLabels = ["Screenshots", "Obsidian Vault", "Media", "History & Settings"]
    private let name = "Obsidian Screenshot Automation"

    private var supportURL: URL {
        if let path = ProcessInfo.processInfo.environment["OBSIDIAN_SCREENSHOTS_SUPPORT"] {
            return URL(fileURLWithPath: path)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Obsidian Screenshot Automation")
    }
    private var profileURL: URL {
        if let path = ProcessInfo.processInfo.environment["OBSIDIAN_SCREENSHOTS_PROFILE"] {
            return URL(fileURLWithPath: path)
        }
        return supportURL.appendingPathComponent("locations.json")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenus()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = name
        window.minSize = NSSize(width: 560, height: 440)
        window.setFrameAutosaveName("MainWindow")
        window.center()
        window.delegate = self
        window.isReleasedWhenClosed = false
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "locations")
        configuration.userContentController.add(self, name: "theme")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startBackend()
    }

    private func installMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About \(name)", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Locations...", action: #selector(editLocations), keyEquivalent: ",")
        appMenu.addItem(withTitle: "Open History Folder", action: #selector(openHistory), keyEquivalent: "")
        appMenu.addItem(withTitle: "Open Log", action: #selector(openLog), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit \(name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        for item in appMenu.items where [#selector(showAbout), #selector(editLocations), #selector(openHistory), #selector(openLog)].contains(item.action) { item.target = self }
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        menu.addItem(windowItem)
        NSApp.mainMenu = menu
        NSApp.windowsMenu = windowMenu
    }

    private func startBackend() {
        startupError = nil
        stoppingFor = nil
        baseURL = nil
        outputBuffer = Data()
        window.title = "\(name) - Starting..."
        do {
            try FileManager.default.createDirectory(at: supportURL, withIntermediateDirectories: true)
            let logURL = supportURL.appendingPathComponent("desktop.log")
            if let size = try? logURL.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 2 * 1024 * 1024 {
                let previous = supportURL.appendingPathComponent("desktop.previous.log")
                try? FileManager.default.removeItem(at: previous)
                try FileManager.default.moveItem(at: logURL, to: previous)
            }
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            logHandle = try FileHandle(forWritingTo: logURL)
            try logHandle?.seekToEnd()
            let resources = Bundle.main.resourceURL!
            let child = Process()
            child.executableURL = resources.appendingPathComponent("bin/node")
            child.arguments = [resources.appendingPathComponent("app/src/desktop.mjs").path]
            child.currentDirectoryURL = resources.appendingPathComponent("app")
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = resources.appendingPathComponent("bin").path + ":/usr/bin:/bin:/usr/sbin:/sbin"
            environment["NODE_OPTIONS"] = nil
            environment["NODE_PATH"] = nil
            environment["OBSIDIAN_SCREENSHOTS_SUPPORT"] = supportURL.path
            environment["OBSIDIAN_SCREENSHOTS_PROFILE"] = profileURL.path
            child.environment = environment
            let inputPipe = Pipe()
            let outputPipe = Pipe()
            child.standardInput = inputPipe
            child.standardOutput = outputPipe
            child.standardError = logHandle
            input = inputPipe
            output = outputPipe
            outputPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { handle.readabilityHandler = nil; return }
                DispatchQueue.main.async { self?.receive(data) }
            }
            child.terminationHandler = { [weak self] child in
                DispatchQueue.main.async { self?.backendExited(child.terminationStatus) }
            }
            process = child
            try child.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self, weak child] in
                guard let self, self.process === child, self.baseURL == nil, self.stoppingFor == nil, child?.isRunning == true else { return }
                self.startupError = "The service did not become ready within 30 seconds."
                child?.terminate()
            }
        } catch {
            process = nil
            showStartupError(error.localizedDescription)
        }
    }

    private func receive(_ data: Data) {
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 10) {
            let line = outputBuffer.prefix(upTo: newline)
            outputBuffer.removeSubrange(...newline)
            guard let message = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let type = message["type"] as? String else { continue }
            if type == "ready", let rawURL = message["url"] as? String, let url = URL(string: rawURL) {
                baseURL = url
                if let config = message["config"] as? [String: Any] {
                    for key in locationKeys { locations[key] = config[key] as? String }
                }
                if !FileManager.default.fileExists(atPath: profileURL.path) { try? saveLocations(locations) }
                window.title = name
                if stoppingFor != nil { send(["type": "shutdown"]); continue }
                webView.load(URLRequest(url: url))
                if locationKeys.prefix(3).contains(where: { !FileManager.default.fileExists(atPath: locations[$0] ?? "") }) {
                    DispatchQueue.main.async { self.editLocations() }
                }
            } else if type == "error" {
                startupError = message["message"] as? String
            } else if type == "stopping", message["busy"] as? Bool == true {
                showWaitingPanel()
            } else if type == "status", message["busy"] as? Bool == false {
                presentLocations()
            } else if type == "status" {
                let alert = NSAlert()
                alert.messageText = "An operation is still running"
                alert.informativeText = "Wait for it to finish before changing locations."
                alert.beginSheetModal(for: window)
            }
        }
    }

    private func send(_ message: [String: Any]) {
        guard process?.isRunning == true, let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        do { try input?.fileHandleForWriting.write(contentsOf: data + Data([10])) }
        catch { startupError = error.localizedDescription }
    }

    private func backendExited(_ status: Int32) {
        output?.fileHandleForReading.readabilityHandler = nil
        try? logHandle?.close()
        process = nil
        input = nil
        output = nil
        if let panel = statusPanel { window.endSheet(panel); panel.orderOut(nil); statusPanel = nil }
        if stoppingFor == "quit" { NSApp.reply(toApplicationShouldTerminate: true) }
        else if stoppingFor == "restart" { startBackend() }
        else { showStartupError(startupError ?? "The service stopped unexpectedly (exit \(status)).") }
    }

    private func showStartupError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Unable to start"
        alert.informativeText = message + "\n\nLog: " + supportURL.appendingPathComponent("desktop.log").path
        alert.addButton(withTitle: "Locations...")
        alert.addButton(withTitle: "Open Log")
        alert.addButton(withTitle: "Quit")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn { presentLocations() }
        else if response == .alertSecondButtonReturn { openLog() }
        else { NSApp.terminate(nil) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard process?.isRunning == true else { return .terminateNow }
        if stoppingFor == "quit" { return .terminateLater }
        stoppingFor = "quit"
        window.title = "\(name) - Closing..."
        stopBackend()
        return .terminateLater
    }

    private func stopBackend() {
        // Let debounced settings reach the server before it stops accepting writes.
        var sent = false
        let stop = { [weak self] in
            guard !sent else { return }
            sent = true
            self?.send(["type": "shutdown"])
        }
        webView.callAsyncJavaScript("await window.flushAppSettings?.()", arguments: [:], in: nil, in: .page) { _ in stop() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: stop)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === window { NSApp.terminate(nil); return false }
        imageWindows.removeAll { $0 === sender }
        return true
    }

    private func showWaitingPanel() {
        guard statusPanel == nil else { return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 430, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        let label = NSTextField(wrappingLabelWithString: "Finishing the current operation before closing...\nPlease keep this Mac awake.")
        label.frame = NSRect(x: 24, y: 24, width: 382, height: 52)
        panel.contentView?.addSubview(label)
        statusPanel = panel
        window.beginSheet(panel)
    }

    @objc private func editLocations() {
        guard stoppingFor == nil else { return }
        if process?.isRunning == true { send(["type": "status"]) }
        else { presentLocations() }
    }

    private func presentLocations() {
        guard window.attachedSheet == nil, stoppingFor == nil else { return }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let defaultVault = home.appendingPathComponent("Library/Mobile Documents/iCloud~md~obsidian/Documents/ambinder").path
        let legacy = home.appendingPathComponent("Documents/Private/Projects/iina-obsidian-screenshot-importer/data").path
        let saved = (try? Data(contentsOf: profileURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } ?? [:]
        pendingLocations = [
            "screenshotsRoot": home.appendingPathComponent("Documents/Private/Pictures/Screenshots").path,
            "vaultRoot": defaultVault,
            "mediaRoot": (defaultVault as NSString).appendingPathComponent("Bases/Databases/Media"),
            "dataDir": FileManager.default.fileExists(atPath: legacy) ? legacy : supportURL.appendingPathComponent("data").path
        ].merging(locations) { _, new in new }.merging(saved) { _, new in new }
        let alert = NSAlert()
        alert.messageText = "Locations"
        alert.informativeText = "Applying locations restarts the service and clears the current selection. Files are not moved. For shared history, select the same synced History & Settings folder on both Macs."
        alert.addButton(withTitle: "Apply and Restart")
        alert.addButton(withTitle: "Cancel")
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 268))
        locationFields = []
        for (index, key) in locationKeys.enumerated() {
            let y = CGFloat(3 - index) * 66
            let label = NSTextField(labelWithString: locationLabels[index])
            label.font = .boldSystemFont(ofSize: 12)
            label.frame = NSRect(x: 0, y: y + 34, width: 430, height: 18)
            view.addSubview(label)
            let field = NSTextField(labelWithString: pendingLocations[key] ?? "")
            field.isSelectable = true
            field.lineBreakMode = .byTruncatingMiddle
            field.frame = NSRect(x: 0, y: y + 5, width: 418, height: 22)
            field.toolTip = field.stringValue
            locationFields.append(field)
            view.addSubview(field)
            let button = NSButton(title: "Choose...", target: self, action: #selector(chooseLocation(_:)))
            button.bezelStyle = .rounded
            button.tag = index
            button.frame = NSRect(x: 428, y: y + 2, width: 92, height: 30)
            view.addSubview(button)
        }
        alert.accessoryView = view
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let vault = URL(fileURLWithPath: pendingLocations["vaultRoot"]!).standardizedFileURL.path
        let media = URL(fileURLWithPath: pendingLocations["mediaRoot"]!).standardizedFileURL.path
        guard media.hasPrefix(vault + "/") else {
            let error = NSAlert()
            error.messageText = "Media must be inside the selected Obsidian vault"
            error.runModal()
            presentLocations()
            return
        }
        do {
            try saveLocations(pendingLocations)
            if process?.isRunning == true { stoppingFor = "restart"; stopBackend() }
            else { startBackend() }
        } catch { showStartupError(error.localizedDescription) }
    }

    @objc private func chooseLocation(_ sender: NSButton) {
        let key = locationKeys[sender.tag]
        let picker = NSOpenPanel()
        picker.canChooseFiles = false
        picker.canChooseDirectories = true
        picker.canCreateDirectories = true
        picker.allowsMultipleSelection = false
        picker.message = locationLabels[sender.tag]
        picker.directoryURL = URL(fileURLWithPath: pendingLocations[key] ?? NSHomeDirectory())
        guard picker.runModal() == .OK, let url = picker.url else { return }
        pendingLocations[key] = url.path
        locationFields[sender.tag].stringValue = url.path
        locationFields[sender.tag].toolTip = url.path
        if key == "vaultRoot" {
            let media = url.appendingPathComponent("Bases/Databases/Media").path
            pendingLocations["mediaRoot"] = media
            locationFields[2].stringValue = media
            locationFields[2].toolTip = media
        }
    }

    private func saveLocations(_ values: [String: String]) throws {
        try FileManager.default.createDirectory(at: profileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: profileURL, options: .atomic)
    }

    @objc private func openHistory() { if let path = locations["dataDir"] { NSWorkspace.shared.open(URL(fileURLWithPath: path)) } }
    @objc private func openLog() { NSWorkspace.shared.open(supportURL.appendingPathComponent("desktop.log")) }
    @objc private func showAbout() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: name, .applicationVersion: version, .version: "Apple Silicon", .credits: NSAttributedString(string: "Local-only screenshot importer. Bundled Node.js, WebP, and FFmpeg. Licenses are included in the app. Corresponding source archives and build instructions accompany the app in its distribution ZIP.")])
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, isLocal(url) else { return }
        if message.name == "locations" { editLocations() }
        if message.name == "theme", let theme = message.body as? String {
            switch theme {
            case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
            case "light": NSApp.appearance = NSAppearance(named: .aqua)
            case "system": NSApp.appearance = nil
            default: break
            }
        }
    }
    private func isLocal(_ url: URL) -> Bool { url.scheme == "http" && url.host == baseURL?.host && url.port == baseURL?.port }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if isLocal(url) || url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if ["https", "obsidian"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url, isLocal(url) else { return nil }
        let preview = WKWebView(frame: .zero, configuration: configuration)
        preview.navigationDelegate = self
        preview.uiDelegate = self
        let child = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        child.title = "Image Preview"
        child.contentView = preview
        child.isReleasedWhenClosed = false
        child.delegate = self
        child.center()
        child.makeKeyAndOrderFront(nil)
        imageWindows.append(child)
        return preview
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: webView.window ?? window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: webView.window ?? window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }
}

let application = NSApplication.shared
let delegate = DesktopApp()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
