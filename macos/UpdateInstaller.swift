import Foundation
import AppKit
import Darwin

enum InstallError: Error, LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

@discardableResult func command(_ executable: String, _ arguments: [String]) throws -> String {
    let process = Process(), output = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = output
    process.standardError = output
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let text = String(decoding: data, as: UTF8.self)
    guard process.terminationStatus == 0 else { throw InstallError.message(text.isEmpty ? "Update validation failed." : text) }
    return text
}

func launchApp(_ app: URL) throws {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.createsNewApplicationInstance = true
    let environment = ProcessInfo.processInfo.environment
    configuration.environment = environment.filter { ["OBSIDIAN_SCREENSHOTS_SUPPORT", "OBSIDIAN_SCREENSHOTS_PROFILE"].contains($0.key) }
    var finished = false
    var failure: Error?
    NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
        DispatchQueue.main.async { failure = error; finished = true }
    }
    let deadline = Date().addingTimeInterval(30)
    while !finished && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    if let failure { throw failure }
    guard finished else { throw InstallError.message("Application launch timed out.") }
}

func report(_ values: [String: String]) {
    if let data = try? JSONSerialization.data(withJSONObject: values) {
        try? FileHandle.standardOutput.write(contentsOf: data + Data([10]))
    }
}

let fm = FileManager.default
var stage: URL?
var replaced = false
var ready = false
var oldApp: URL?
var backup: URL?
var log: URL?
// Remove only this updater-owned copied executable after it exits.
let ownDirectory = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
defer {
    if ownDirectory.lastPathComponent.hasPrefix("installer-"), ownDirectory.deletingLastPathComponent().lastPathComponent == "updates" {
        try? fm.removeItem(at: ownDirectory)
    }
}
do {
    let args = CommandLine.arguments
    guard args.count == 8, let parentPID = Int32(args[1]), parentPID > 1,
          args[4].range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil,
          args[5].range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
        throw InstallError.message("Invalid update request.")
    }
    let app = URL(fileURLWithPath: args[2]).standardizedFileURL
    oldApp = app
    let archive = URL(fileURLWithPath: args[3]).standardizedFileURL
    let support = URL(fileURLWithPath: args[6]).standardizedFileURL
    log = support.appendingPathComponent("update.log")
    let validateOnly = args[7] == "validate-only"
    guard validateOnly || args[7] == "install" else { throw InstallError.message("Invalid update action.") }
    guard app.pathExtension == "app", app.path == app.resolvingSymlinksInPath().path,
          !app.path.contains("/AppTranslocation/"), !app.path.hasPrefix("/Volumes/"),
          fm.isWritableFile(atPath: app.deletingLastPathComponent().path), fm.isWritableFile(atPath: app.path) else {
        throw InstallError.message("Move the application to a writable local Applications folder before updating. A translocated, read-only, or external-volume copy cannot be replaced.")
    }
    let archiveValues = try archive.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard archiveValues.isRegularFile == true, archiveValues.isSymbolicLink != true else { throw InstallError.message("Invalid update archive.") }
    guard try command("/usr/bin/shasum", ["-a", "256", archive.path]).hasPrefix(args[5] + " ") else {
        throw InstallError.message("The update archive checksum changed. Download it again.")
    }
    let entries = try command("/usr/bin/unzip", ["-Z1", archive.path]).split(separator: "\n")
    guard !entries.isEmpty, entries.allSatisfy({ entry in
        !entry.hasPrefix("/") && !entry.contains("\\") && !entry.split(separator: "/").contains("..")
    }) else { throw InstallError.message("Unsafe paths in the update archive.") }
    let listing = try command("/usr/bin/zipinfo", ["-l", archive.path])
    guard !listing.split(separator: "\n").contains(where: { $0.hasPrefix("l") }) else {
        throw InstallError.message("Symbolic links are not supported in update archives.")
    }
    let totals = try command("/usr/bin/zipinfo", ["-t", archive.path])
    let expression = try NSRegularExpression(pattern: "([0-9]+) bytes uncompressed")
    guard let match = expression.firstMatch(in: totals, range: NSRange(totals.startIndex..., in: totals)),
          let range = Range(match.range(at: 1), in: totals), let size = UInt64(totals[range]), size <= 1024 * 1024 * 1024 else {
        throw InstallError.message("The extracted update exceeds the supported size.")
    }
    let staging = app.deletingLastPathComponent().appendingPathComponent(".obsidian-importer-update-" + UUID().uuidString)
    stage = staging
    try fm.createDirectory(at: staging, withIntermediateDirectories: false)
    let extracted = staging.appendingPathComponent("release")
    try command("/usr/bin/ditto", ["-x", "-k", archive.path, extracted.path])
    guard let files = fm.enumerator(at: extracted, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { throw InstallError.message("Cannot inspect the update.") }
    var candidates: [URL] = []
    for case let file as URL in files {
        guard try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw InstallError.message("Symbolic links are not supported in update archives.") }
        if file.lastPathComponent == "Obsidian Screenshot Importer.app" { candidates.append(file) }
    }
    guard candidates.count == 1 else { throw InstallError.message("The update must contain exactly one application.") }
    let newApp = candidates[0]
    let infoData = try Data(contentsOf: newApp.appendingPathComponent("Contents/Info.plist"))
    let info = try PropertyListSerialization.propertyList(from: infoData, format: nil) as? [String: Any]
    guard info?["CFBundleIdentifier"] as? String == "local.ambinder.obsidian-screenshot-automation.desktop",
          info?["CFBundleExecutable"] as? String == "ObsidianScreenshotImporter",
          info?["CFBundleShortVersionString"] as? String == args[4] else { throw InstallError.message("The update application identity or version does not match.") }
    try command("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp.path])
    guard try command("/usr/bin/lipo", ["-archs", newApp.appendingPathComponent("Contents/MacOS/ObsidianScreenshotImporter").path]).split(whereSeparator: { $0.isWhitespace }).contains("arm64") else {
        throw InstallError.message("The update is not compatible with Apple Silicon.")
    }
    if validateOnly {
        try fm.removeItem(at: staging)
        stage = nil
        report(["type": "validated", "version": args[4]])
        exit(0)
    }
    ready = true
    report(["type": "ready"])
    // The host quits only after receiving ready and gracefully stopping its backend.
    let deadline = Date().addingTimeInterval(120)
    while kill(parentPID, 0) == 0 || errno == EPERM {
        guard Date() < deadline else { throw InstallError.message("The application did not close in time. The installed copy has not been changed.") }
        Thread.sleep(forTimeInterval: 0.2)
    }
    let saved = staging.appendingPathComponent("Previous.app")
    backup = saved
    try fm.moveItem(at: app, to: saved)
    do { try fm.moveItem(at: newApp, to: app); replaced = true }
    catch { try fm.moveItem(at: saved, to: app); throw error }
    let launchedAt = Date()
    try launchApp(app)
    let marker = support.appendingPathComponent("updates/installation-ready.json")
    let launchDeadline = Date().addingTimeInterval(60)
    var started = false
    while Date() < launchDeadline {
        if let data = try? Data(contentsOf: marker), let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           state["version"] as? String == args[4], let markerPath = state["appPath"] as? String,
           URL(fileURLWithPath: markerPath).standardizedFileURL.resolvingSymlinksInPath() == app.resolvingSymlinksInPath(),
           let time = state["timestamp"] as? Double, time >= launchedAt.timeIntervalSince1970 {
            started = true
            break
        }
        Thread.sleep(forTimeInterval: 0.25)
    }
    guard started else { throw InstallError.message("The update was installed, but startup could not be confirmed. The previous application is retained at \(saved.path).") }
    try fm.removeItem(at: staging)
    stage = nil
    try? fm.removeItem(at: archive.deletingLastPathComponent())
    try? Data("Installed \(args[4]) at \(Date())\n".utf8).write(to: log!, options: .atomic)
} catch {
    let message = error.localizedDescription
    if replaced, let app = oldApp, let saved = backup, fm.fileExists(atPath: saved.path), !message.contains("startup could not be confirmed") {
        try? fm.removeItem(at: app)
        try? fm.moveItem(at: saved, to: app)
        try? launchApp(app)
    }
    if !replaced, let staging = stage { try? fm.removeItem(at: staging) }
    if let log { try? Data((message + "\n").utf8).write(to: log, options: .atomic) }
    if ready {
        let alert = NSAlert()
        alert.messageText = "Unable to complete the update"
        alert.informativeText = message
        alert.runModal()
    } else { report(["type": "error", "message": message]) }
    if ownDirectory.lastPathComponent.hasPrefix("installer-"), ownDirectory.deletingLastPathComponent().lastPathComponent == "updates" {
        try? fm.removeItem(at: ownDirectory)
    }
    exit(1)
}
