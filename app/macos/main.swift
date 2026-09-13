import Cocoa
import WebKit

/// 支持从 Finder 拖入文件并拿到完整路径（WKWebView 的 JS 层只能拿到文件名）
final class DropWebView: WKWebView {
  var onDropPaths: (([String]) -> Void)?

  override init(frame: CGRect, configuration: WKWebViewConfiguration) {
    super.init(frame: frame, configuration: configuration)
    registerForDraggedTypes([.fileURL])
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    registerForDraggedTypes([.fileURL])
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    return .copy
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    let pb = sender.draggingPasteboard
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    guard let urls = pb.readObjects(forClasses: [NSURL.self], options: options) as? [URL],
          !urls.isEmpty else { return false }
    onDropPaths?(urls.map { $0.path })
    return true
  }
}

// 拾忆 - macOS 本地应用封装
// 启动时自动拉起内嵌的 Node 服务（server.mjs），并用原生 WebView 打开面板

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  private var window: NSWindow!
  private var webView: DropWebView!
  private var server: Process?
  private var logHandle: FileHandle?
  private var pollCount = 0

  private func appLog(_ msg: String) {
    let line = "[\(Date())] \(msg)\n"
    let url = URL(fileURLWithPath: "/tmp/zyin-app.log")
    do {
      if FileManager.default.fileExists(atPath: url.path) {
        let h = try FileHandle(forWritingTo: url)
        h.seekToEndOfFile()
        if let data = line.data(using: .utf8) { h.write(data) }
        try? h.close()
      } else {
        try line.data(using: .utf8)?.write(to: url)
      }
    } catch {
      NSLog("appLog 失败: \(error)")
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    appLog("启动")
    buildMenu()
    buildWindow()
    startServerAndLoad()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    stopServer()
  }

  // MARK: - UI

  private func buildMenu() {
    let mainMenu = NSMenu()
    let appItem = NSMenuItem()
    mainMenu.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(
      withTitle: "关于 拾忆",
      action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
      keyEquivalent: ""
    )
    appMenu.addItem(.separator())
    appMenu.addItem(
      withTitle: "退出 拾忆",
      action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q"
    )
    appItem.submenu = appMenu

    let editItem = NSMenuItem()
    mainMenu.addItem(editItem)
    let editMenu = NSMenu(title: "编辑")
    editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    let copyItem = NSMenuItem(title: "拷贝", action: #selector(AppDelegate.copyFromTerminal(_:)), keyEquivalent: "c")
    copyItem.target = self
    editMenu.addItem(copyItem)
    let pasteItem = NSMenuItem(title: "粘贴", action: #selector(AppDelegate.pasteToTerminal(_:)), keyEquivalent: "v")
    pasteItem.target = self
    editMenu.addItem(pasteItem)
    editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = editMenu

    NSApp.mainMenu = mainMenu
  }

  private func buildWindow() {
    let rect = NSRect(x: 0, y: 0, width: 1080, height: 720)
    window = NSWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "拾忆 · 会话面板"
    window.minSize = NSSize(width: 860, height: 560)
    window.center()

    let config = WKWebViewConfiguration()
    webView = DropWebView(frame: rect, configuration: config)
    webView.onDropPaths = { [weak self] paths in
      guard let self = self, let data = try? JSONSerialization.data(withJSONObject: paths),
            let json = String(data: data, encoding: .utf8) else { return }
      self.webView.evaluateJavaScript("window.__shiyiInsertPaths && window.__shiyiInsertPaths(\(json))")
    }
    webView.navigationDelegate = self

    let placeholder = NSTextField(labelWithString: "正在启动本地服务…")
    placeholder.alignment = .center
    placeholder.textColor = .secondaryLabelColor
    placeholder.frame = NSRect(x: 0, y: 0, width: 300, height: 40)

    let container = NSView(frame: rect)
    webView.translatesAutoresizingMaskIntoConstraints = false
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(placeholder)
    NSLayoutConstraint.activate([
      placeholder.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      placeholder.centerYAnchor.constraint(equalTo: container.centerYAnchor),
    ])
    window.contentView = container
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func showPanel() {
    guard let container = window.contentView, let current = container.subviews.first else { return }
    if current === webView { return }
    webView.translatesAutoresizingMaskIntoConstraints = true
    webView.frame = container.bounds
    webView.autoresizingMask = [.width, .height]
    current.removeFromSuperview()
    container.addSubview(webView)
    appLog("开始加载 http://127.0.0.1:8787/")
    webView.load(URLRequest(url: URL(string: "http://127.0.0.1:8787/")!))
  }

  // MARK: - Server

  // MARK: - 终端剪贴板
  //
  // WKWebView 不允许页面自己读剪贴板（navigator.clipboard.readText 会被拒绝），
  // 所以 ⌘C / ⌘V 都走原生：由 Swift 读写 NSPasteboard，再注入终端。
  // 焦点不在终端里（搜索框、重命名、配置编辑器等）时，交回系统默认行为。

  @objc func pasteToTerminal(_ sender: Any?) {
    webView.evaluateJavaScript("window.__shiyiFocusArea ? window.__shiyiFocusArea() : 'input'") { [weak self] result, _ in
      guard let self = self else { return }
      guard (result as? String) == "terminal" else {
        NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: nil)
        return
      }
      let text = NSPasteboard.general.string(forType: .string) ?? ""
      guard !text.isEmpty else { return }
      self.webView.evaluateJavaScript("window.__shiyiPaste && window.__shiyiPaste(\(Self.jsLiteral(text)))")
      self.appLog("终端粘贴 \(text.count) 字符")
    }
  }

  @objc func copyFromTerminal(_ sender: Any?) {
    webView.evaluateJavaScript("window.__shiyiFocusArea ? window.__shiyiFocusArea() : 'input'") { [weak self] result, _ in
      guard let self = self else { return }
      guard (result as? String) == "terminal" else {
        NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: nil)
        return
      }
      self.webView.evaluateJavaScript("window.__shiyiCopySelection ? (window.__shiyiCopySelection() || '') : ''") { value, _ in
        guard let text = value as? String, !text.isEmpty else {
          NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: nil)
          return
        }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        self.appLog("终端复制 \(text.count) 字符")
      }
    }
  }

  /// 生成安全的 JS 字符串字面量（引号、换行、反斜杠、U+2028/2029 都要转义）
  private static func jsLiteral(_ s: String) -> String {
    var out = "\""
    for scalar in s.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{2028}": out += "\\u2028"
      case "\u{2029}": out += "\\u2029"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    return out + "\""
  }

  private func startServerAndLoad() {
    let resources = Bundle.main.resourcePath ?? ""
    let serverDir = (resources as NSString).appendingPathComponent("server")
    let serverFile = (serverDir as NSString).appendingPathComponent("server.mjs")

    // Finder 启动的应用 PATH 很干净，这里显式补全常见 Node 路径
    var env = ProcessInfo.processInfo.environment
    env["HOME"] = NSHomeDirectory()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    server = Process()
    // 通过登录 shell 启动，确保能找到用户通过 Homebrew / nvm 安装的 node
    server?.executableURL = URL(fileURLWithPath: "/bin/bash")
    server?.arguments = ["-lc", "exec node \"$0\"", serverFile]
    server?.currentDirectoryURL = URL(fileURLWithPath: serverDir)
    server?.environment = env

    // 服务日志写到 /tmp/zyin-app-server.log，便于排查
    let logURL = URL(fileURLWithPath: "/tmp/zyin-app-server.log")
    FileManager.default.createFile(atPath: logURL.path, contents: nil)
    if let handle = try? FileHandle(forWritingTo: logURL) {
      logHandle = handle
      server?.standardOutput = handle
      server?.standardError = handle
    }

    do {
      try server?.run()
      appLog("服务进程已启动，开始探测")
    } catch {
      NSLog("无法启动服务: \(error)")
      appLog("服务启动失败: \(error)")
      pollServer(forceLoad: true)
      return
    }
    pollServer(forceLoad: false)
  }

  private func pollServer(forceLoad: Bool) {
    let url = URL(string: "http://127.0.0.1:8787/api/state")!
    var req = URLRequest(url: url)
    req.timeoutInterval = 2
    URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
      guard let self = self else { return }
      let ok = (resp as? HTTPURLResponse)?.statusCode == 200
      if ok || forceLoad {
        self.appLog(ok ? "探测成功(HTTP 200)" : "强制加载")
        DispatchQueue.main.async { self.showPanel() }
        return
      }
      self.pollCount += 1
      if self.pollCount < 25 {
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.8) {
          self.pollServer(forceLoad: false)
        }
      } else {
        NSLog("等待服务超时，日志见 /tmp/zyin-app-server.log")
      }
    }.resume()
  }

  private func stopServer() {
    if let p = server, p.isRunning {
      p.terminate()
    }
    try? logHandle?.close()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    appLog("页面加载完成")
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    appLog("页面加载失败: \(error.localizedDescription)")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    appLog("导航失败: \(error.localizedDescription)")
  }

  // 只允许本地面板页面
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let host = navigationAction.request.url?.host, host == "127.0.0.1" || navigationAction.request.url?.scheme == "about" {
      decisionHandler(.allow)
    } else if navigationAction.navigationType == .linkActivated {
      if let url = navigationAction.request.url {
        NSWorkspace.shared.open(url)
      }
      decisionHandler(.cancel)
    } else {
      decisionHandler(.allow)
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
